# 辅助 API 调用缺失 — 修复方案

> 问题：dario 只代理 `/v1/messages`，CC 客户端的辅助 API 调用（bootstrap、grove、MCP 等）被 403 拒绝。
> 这导致两个问题：(1) CC 部分功能不可用（如 MCP 服务器发现）；(2) 从 Anthropic 服务端看，一个"CC 客户端"只调 `/v1/messages` 是异常流量模式。

---

## 1. 真实 CC 的完整请求序列

一次 CC 会话期间，客户端会按以下顺序调 Anthropic API：

```
 1. POST  /api/eval/sdk-{id}                        UA: Bun/1.3.14           ← CC 内部遥测
 2. GET   /v1/mcp_servers?limit=1000                 UA: axios/1.13.6         ← MCP 服务器列表
 3. GET   /api/claude_cli/bootstrap?entrypoint=...   UA: claude-code/2.1.133  ← CC 启动配置
 4. GET   /api/claude_code_penguin_mode              UA: axios/1.13.6         ← 功能开关
 5. GET   /mcp-registry/v0/servers?...               UA: axios/1.13.6         ← MCP 市场（分页）
 6. GET   /api/oauth/account/settings                UA: claude-code/2.1.133  ← 账户设置
 7. GET   /api/claude_code_grove                     UA: claude-cli/2.1.133   ← CC 功能检查
 8. POST  /v1/messages?beta=true (preflight)         UA: claude-cli/2.1.133   ← 已修复 ✅
 9. POST  /v1/messages?beta=true (main)              UA: claude-cli/2.1.133   ← 已修复 ✅
10. POST  /api/event_logging/v2/batch                UA: claude-code/2.1.133  ← 事件日志
11. POST  https://http-intake.logs.datadoghq.com/... UA: axios/1.13.6         ← 外部 Datadog
```

dario 当前只转发 #8 和 #9，其余全部 403。

---

## 2. 端点分类与处理策略

### 策略 A：透传（Forward）— 需要真实响应，CC 功能依赖

这些端点 CC 需要真实响应才能正常工作。dario 透传到 `api.anthropic.com`，替换认证头。

| 端点 | 方法 | 用途 | 透传理由 |
|------|------|------|---------|
| `/v1/mcp_servers` | GET | 列出用户可用的 MCP 服务器 | CC 需要此数据发现/连接 MCP 服务器 |
| `/mcp-registry/v0/servers` | GET | MCP 服务器市场（分页） | 同上 |
| `/api/claude_cli/bootstrap` | GET | CC 启动配置 | CC 依赖此配置初始化 |
| `/api/oauth/account/settings` | GET | 账户设置（限额、权限等） | CC 需要知道账户能力 |
| `/api/claude_code_grove` | GET | CC 功能检查 | CC 可能据此启用/禁用功能 |
| `/api/claude_code_penguin_mode` | GET | 功能开关 | CC 可能据此调整行为 |

**透传实现要点：**
- URL 前缀匹配：`/v1/mcp_servers*`、`/mcp-registry/*`、`/api/claude_cli/*` 等
- 认证替换：CC 发来的 `x-api-key: dario-key` 替换为 `Authorization: Bearer {oauth_token}`
- User-Agent 保留：CC 发来的 UA（axios、claude-code 等）原样透传，不做修改
- GET 和 POST 都需要支持（当前只允许 POST）
- Query 参数透传（如 `?limit=1000`、`?cursor=...`）

### 策略 B：静默吞掉（Absorb）— 返回空响应，不泄露遥测

这些端点是 CC 的遥测/日志上报。转发会给 Anthropic 发送包含 dario 运行环境信息的数据，可能暴露 dario 的存在。静默返回 200 空/假响应即可。

| 端点 | 方法 | 用途 | 吞掉理由 |
|------|------|------|---------|
| `/api/eval/sdk-{id}` | POST | CC 内部遥测 | 数据包含运行环境信息，可能暴露 dario |
| `/api/event_logging/v2/batch` | POST | 事件日志 | 同上 |

**静默响应实现：**
- `/api/eval/sdk-*`：返回 `200 {}`
- `/api/event_logging/v2/batch`：返回 `200 {"status":"ok"}`

### 策略 C：阻断（Block）— 外部服务，与 Anthropic 无关

| 端点 | 方法 | 用途 | 阻断理由 |
|------|------|------|---------|
| Datadog (`http-intake.logs.datadoghq.com`) | POST | 外部日志 | 不走 Anthropic API，与指纹无关 |

**实现：** 保持现有 403 行为即可。Datadog 请求的 host 是外部域名，CC 如果配了 `ANTHROPIC_BASE_URL` 不会把 Datadog 请求发到 dario，所以不需要处理。

---

## 3. 实现方案

### 3.1 新增辅助 API 转发模块

**新文件**: `src/aux-proxy.ts`

```typescript
/**
 * Auxiliary API proxy — forwards CC's non-messages API calls to api.anthropic.com.
 *
 * CC makes auxiliary calls (bootstrap, grove, MCP, etc.) using different
 * User-Agents than /v1/messages (axios, Bun, claude-code). This module
 * forwards those requests with auth replacement, keeping the traffic pattern
 * consistent with real CC.
 */

const ANTHROPIC_API = 'https://api.anthropic.com';

// Endpoints that need real responses — forwarded to Anthropic
const FORWARD_PATTERNS: Array<{ prefix: string; methods: string[] }> = [
  { prefix: '/v1/mcp_servers',     methods: ['GET'] },
  { prefix: '/mcp-registry/',      methods: ['GET'] },
  { prefix: '/api/claude_cli/',    methods: ['GET'] },
  { prefix: '/api/oauth/',         methods: ['GET'] },
  { prefix: '/api/claude_code',    methods: ['GET'] },  // grove + penguin_mode
];

// Endpoints that should be silently absorbed (return fake 200)
const ABSORB_PATTERNS: Array<{ prefix: string; methods: string[]; response: string }> = [
  { prefix: '/api/eval/sdk-',      methods: ['POST'], response: '{}' },
  { prefix: '/api/event_logging/', methods: ['POST'], response: '{"status":"ok"}' },
];

export interface AuxProxyResult {
  action: 'forward' | 'absorb' | 'unknown';
  targetUrl?: string;
  absorbResponse?: string;
}

/**
 * Classify an incoming request path and method.
 * Returns the action to take.
 */
export function classifyAuxRequest(urlPath: string, method: string): AuxProxyResult {
  // Check absorb patterns first (higher priority — prevent data leaks)
  for (const p of ABSORB_PATTERNS) {
    if (urlPath.startsWith(p.prefix) && p.methods.includes(method)) {
      return { action: 'absorb', absorbResponse: p.response };
    }
  }

  // Check forward patterns
  for (const p of FORWARD_PATTERNS) {
    if (urlPath.startsWith(p.prefix) && p.methods.includes(method)) {
      const query = /* original query string */;
      return { action: 'forward', targetUrl: `${ANTHROPIC_API}${urlPath}${query}` };
    }
  }

  return { action: 'unknown' };
}

/**
 * Forward an auxiliary request to api.anthropic.com.
 * Replaces auth header with the real OAuth token.
 */
export async function forwardAuxRequest(
  targetUrl: string,
  req: IncomingMessage,
  res: ServerResponse,
  accessToken: string,
): Promise<void> {
  // Build headers: keep CC's original headers but replace auth
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value !== 'string') continue;
    const lower = key.toLowerCase();
    // Skip hop-by-hop headers and auth (we replace it)
    if (['host', 'connection', 'transfer-encoding', 'x-api-key',
         'authorization', 'content-length'].includes(lower)) continue;
    headers[key] = value;
  }
  // Replace auth with real OAuth token
  headers['Authorization'] = `Bearer ${accessToken}`;

  // Read request body (for POST)
  const body = method === 'POST' ? await readBody(req) : undefined;

  // Forward the request
  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers,
    body,
  });

  // Stream response back to CC client
  res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
  const reader = upstream.body?.getReader();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
}
```

### 3.2 修改 proxy.ts 的请求路由

**修改文件**: `src/proxy.ts`

在 `allowedPaths` 检查之前，插入辅助 API 路由逻辑：

```typescript
// ---- 现有代码 (line ~1074) ----
if (urlPath === '/v1/models' && req.method === 'GET') { ... }

// ---- 新增：辅助 API 路由 ----
const auxResult = classifyAuxRequest(urlPath, req.method ?? '');
if (auxResult.action === 'absorb') {
  // 静默吞掉遥测/日志请求
  res.writeHead(200, JSON_HEADERS);
  res.end(auxResult.absorbResponse);
  return;
}
if (auxResult.action === 'forward') {
  // 透传到 api.anthropic.com
  await forwardAuxRequest(auxResult.targetUrl!, req, res, accessToken);
  return;
}

// ---- 现有代码 (line ~1079) ----
// Allowlisted API paths — only these are proxied (prevents SSRF)
const allowedPaths: Record<string, string> = { ... };
```

**关键修改点：**

1. **认证替换逻辑**：CC 客户端发来 `x-api-key: dario-key` 或 `Authorization: Bearer dario-key`，需要替换为真实的 OAuth Bearer token。这是核心安全点 — 不能把 dario 的内部 API key 泄露给 Anthropic。

2. **GET 方法支持**：当前 proxy 只允许 POST。辅助 API 多数是 GET 请求，需要放开。

3. **Query 参数透传**：`req.url` 包含完整 query string（如 `?limit=1000&cursor=xxx`），需要原样拼接。

4. **URL 前缀匹配**：不能用精确匹配（如 `/api/eval/sdk-` 后面跟动态 ID），用 `startsWith` 匹配。

5. **响应流式透传**：部分端点可能返回较大 JSON（如 MCP 服务器列表），需要流式转发避免内存问题。

### 3.3 需要注意的边界情况

| 问题 | 处理方式 |
|------|---------|
| CC 发来的 `Host` header 是 dario 的 | 删除，让 fetch 自动设为 `api.anthropic.com` |
| CC 的 `x-api-key` vs `Authorization` | 两种都要替换为 `Authorization: Bearer` |
| 429 / 错误响应 | 原样返回给 CC，让 CC 自己处理 |
| 大响应（MCP 列表可能很长） | 流式透传，不缓冲整个 body |
| 账号池模式下切换 token | 使用当前请求的 `accessToken`（已由 pool 逻辑选定） |
| SSRF 防护 | `FORWARD_PATTERNS` 白名单限制，不在列表中的路径仍然 403 |

---

## 4. 对流量指纹的影响

### 修复前（当前）

从 Anthropic 服务端看，一个"CC 客户端"的请求序列：

```
POST /v1/messages?beta=true (preflight)
POST /v1/messages?beta=true (main)
```

只有 2 个请求，全部是 `/v1/messages`，缺少所有辅助调用。

### 修复后

从 Anthropic 服务端看：

```
POST /api/eval/sdk-{id}              ← 返回 200 但被 dario 吞掉，Anthropic 看不到
GET  /v1/mcp_servers?limit=1000      ← 透传，Anthropic 看到真实请求
GET  /api/claude_cli/bootstrap?...    ← 透传
GET  /api/claude_code_penguin_mode    ← 透传
GET  /mcp-registry/v0/servers?...     ← 透传
GET  /api/oauth/account/settings      ← 透传
GET  /api/claude_code_grove           ← 透传
POST /v1/messages?beta=true (preflight)
POST /v1/messages?beta=true (main)
POST /api/event_logging/v2/batch      ← 返回 200 但被 dario 吞掉，Anthropic 看不到
```

与真实 CC 的流量模式基本一致（除了 eval 和 event_logging 被吞掉）。

### 遥测数据的权衡

- **转发遥测的风险**：`/api/eval/sdk-{id}` 和 `/api/event_logging/v2/batch` 的数据可能包含 dario 容器的环境信息（OS、hostname、运行时特征等），如果 Anthropic 分析这些数据，可能发现异常。
- **不转发遥测的风险**：真实 CC 一定会发这两个请求。如果 Anthropic 检测到"一个 CC 客户端不发遥测"，这也是异常。
- **建议**：初期先吞掉（静默返回 200）。后续如果需要更高保真度，可以构造符合 CC 格式的假遥测数据转发。但这需要深入了解 CC 遥测的 payload 格式，实现成本较高。

---

## 5. 修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `src/aux-proxy.ts`（新建） | 辅助 API 路由分类 + 转发逻辑 + 静默吞掉逻辑 |
| `src/proxy.ts` | 在 `allowedPaths` 检查前插入 `classifyAuxRequest` 路由；放开 GET 方法限制 |

**不需要修改的文件：**
- `src/upstream-client.ts` — 辅助 API 不走 SDK 路径（它们不用 CC 的 header 格式）
- `src/cc-template.ts` — 不涉及模板重建
- `src/cc-template-data.json` — 不涉及

---

## 6. 风险与注意事项

1. **认证泄露**：必须确保 dario 的内部 API key 不会透传到 Anthropic。所有转发请求必须用 `Authorization: Bearer {oauth_token}` 替换原始认证头。
2. **SSRF 防护**：`FORWARD_PATTERNS` 白名单必须严格限制。不能允许任意路径透传，否则攻击者可利用 dario 作为 SSRF 代理。
3. **OAuth token 刷新**：辅助 API 使用同一个 OAuth token。如果 token 过期，需要与 `/v1/messages` 共享刷新逻辑。
4. **响应格式兼容**：CC 期望特定格式的响应。如果 Anthropic 的 API 版本更新导致响应格式变化，CC 可能出错。透传模式自然解决这个问题（响应直接来自 Anthropic）。
5. **并发限制**：辅助 API 不应计入 dario 的请求队列（`RequestQueue`），因为它们不是 inference 请求。应该直接透传，不排队。
6. **超时**：辅助 API 的响应通常很快（< 1s），但也有例外（MCP 列表可能慢）。设置 30s 超时足够。

---

## 7. 验证方案

1. 部署修改后的 dario 到 Lisa
2. 配置 CC 连接 dario（`ANTHROPIC_BASE_URL=http://dario:3456`）
3. 通过 mitmproxy 抓包 dario 的出站请求
4. 确认辅助 API 请求被正确转发（不是 403）
5. 确认 CC 可以发现和连接 MCP 服务器
6. 确认 CC 的 bootstrap/grove 调用正常返回
7. 确认遥测请求被静默吞掉（CC 不报错，Anthropic 不收到数据）
8. 对比真实 CC 的请求序列，确认模式一致

---

## 8. 实现优先级

| 优先级 | 内容 | 理由 |
|--------|------|------|
| P0 | 透传 MCP 相关端点（`/v1/mcp_servers`、`/mcp-registry/`） | CC 功能直接依赖，且是流量指纹差异最明显的 |
| P1 | 透传配置端点（`/api/claude_cli/bootstrap`、`/api/oauth/account/settings`） | CC 启动依赖，且真实 CC 一定会调 |
| P1 | 透传功能检查端点（`/api/claude_code_grove`、`/api/claude_code_penguin_mode`） | 流量指纹一致性 |
| P2 | 静默吞掉遥测端点（`/api/eval/sdk-*`、`/api/event_logging/`） | 防止 CC 报错，但不影响功能 |
