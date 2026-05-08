# dario vs 真实 CC 流量差异分析

> 基于 Lisa 服务器 mitmproxy 抓包数据，对比 dario (线上 v2.1.123) 与真实 Claude Code (v2.1.133) 的流量差异。
> 抓包时间: 2026-05-08

---

## P0 — 关键差异（可直接用于识别非官方客户端）

### 1. `x-anthropic-billing-header` HTTP Header 多余

| 维度 | 真实 CC | dario |
|------|---------|-------|
| HTTP Headers | **不存在** | 存在 (`x-anthropic-billing-header: cc_version=2.1.123.xxx; ...`) |
| System Prompt Body | 存在 (`x-anthropic-billing-header: cc_version=2.1.133.897; ...`) | 存在（类似格式） |

**说明**: CC 的 billing 信息仅存在于 system prompt block[0] 的文本中，不会作为 HTTP header 发送。dario 在 HTTP 层额外发送了 `x-anthropic-billing-header`，这是一个 CC 请求中不应出现的 header，可直接作为检测标记。

**代码位置**: `src/proxy.ts:1547`

---

### 2. `anthropic-dangerous-direct-browser-access` 缺失

| 维度 | 真实 CC | dario |
|------|---------|-------|
| HTTP Header | `anthropic-dangerous-direct-browser-access: true` | **不存在** |

**说明**: dario 代码注释声称"Real CC CLI never sends this header"，但抓包证明 CC 确实发送了该 header（值为 `true`）。删除该 header 反而暴露差异。

**代码位置**: `src/proxy.ts:795`（被注释删除）

---

### 3. HTTP Header 顺序严重不一致

真实 CC 的 header 顺序：

```
 1. Accept
 2. Authorization
 3. Content-Type
 4. User-Agent
 5. X-Claude-Code-Session-Id
 6. X-Stainless-Arch
 7. X-Stainless-Lang
 8. X-Stainless-OS
 9. X-Stainless-Package-Version
10. X-Stainless-Retry-Count
11. X-Stainless-Runtime
12. X-Stainless-Runtime-Version
13. X-Stainless-Timeout
14. anthropic-beta
15. anthropic-dangerous-direct-browser-access
16. anthropic-version
17. x-app
18. x-client-request-id
19. Connection
20. Host
21. Accept-Encoding
22. Content-Length
```

dario 的 header 顺序：

```
 1. accept
 2. Content-Type                    ← Accept 之后直接是 Content-Type，缺少 Authorization
 3. user-agent
 4. x-claude-code-session-id
 5. x-stainless-arch
 6. x-stainless-lang
 7. x-stainless-os
 8. x-stainless-package-version
 9. x-stainless-retry-count
10. x-stainless-runtime
11. x-stainless-runtime-version
12. x-stainless-timeout
13. anthropic-beta
14. anthropic-version               ← 提前到 beta 之后，CC 中在 dangerous-direct 之后
15. x-app
16. Authorization                   ← 被排到第16位，CC 中在第2位
17. x-anthropic-billing-header      ← CC 中不存在此 header
18. x-client-request-id             ← 被排到末尾，CC 中在第18位（但前面没有多余 header）
```

**根本原因**:
- dario 的 `header_order` 模板中没有 `Authorization`，导致它被追加到末尾
- 模板中没有 `anthropic-dangerous-direct-browser-access`（因为被删除了）
- 模板中没有 `x-anthropic-billing-header` 和 `x-client-request-id`（动态字段）
- 模板中有 `x-api-key` 但 CC 用 OAuth 不发这个

**代码位置**: `src/cc-template-data.json` 的 `header_order` 字段

---

## P1 — 重要差异（可作为辅助检测信号）

### 4. `x-stainless-os` 值不一致

| 维度 | 真实 CC (Lisa) | dario |
|------|----------------|-------|
| x-stainless-os | `Linux` | `Windows` |

**说明**: dario 代码 `hv['x-stainless-os'] || OS_NAME`，模板里硬编码了 `Windows`（在 Windows 上抓的模板），优先级高于运行时检测的 `OS_NAME`（Linux）。在 Linux 服务器上运行却报告 Windows 是可检测的矛盾。

**代码位置**: `src/proxy.ts:802`，`src/cc-template-data.json` 的 `header_values.x-stainless-os`

---

### 5. CC 版本号过旧

| 维度 | 真实 CC | dario |
|------|---------|-------|
| User-Agent | `claude-cli/2.1.133 (external, sdk-cli)` | `claude-cli/2.1.123 (external, sdk-cli)` |
| billing (body) | `cc_version=2.1.133.897` | `cc_version=2.1.123.xxx` |
| template_version | 2.1.133 | 2.1.123 |

**说明**: dario 模板停留在 2.1.123，CC 已更新到 2.1.133。版本号出现在 User-Agent、billing header、system prompt 等多处，且需要保持一致。

**代码位置**: `src/cc-template-data.json` 的 `_version` 和 `header_values.user-agent`

---

### 6. `anthropic-beta` 标志集不一致

| 维度 | 真实 CC (主请求) | dario |
|------|-------------------|-------|
| 完整值 | `oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,claude-code-20250219,advisor-tool-2026-03-01,extended-cache-ttl-2025-04-11` | `claude-code-20250219,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advisor-tool-2026-03-01,effort-2025-11-24,afk-mode-2026-01-31,oauth-2025-04-20` |

差异明细：

| Flag | CC | dario | 说明 |
|------|----|-------|------|
| `oauth-2025-04-20` | 第1位 | 最后追加 | 位置不同 |
| `extended-cache-ttl-2025-04-11` | 有 | **缺失** | dario 未包含 |
| `effort-2025-11-24` | **缺失** | 有 | dario 多出 |
| `afk-mode-2026-01-31` | **缺失** | 有 | dario 多出 |

**代码位置**: `src/cc-template-data.json` 的 `anthropic_beta`，`src/proxy.ts:843-855`

---

## P2 — 次要差异（深层次检测可能用到）

### 7. CC 发两个 `/v1/messages` 请求

| 维度 | 真实 CC | dario |
|------|---------|-------|
| 请求模式 | 先发预检请求 (1555B, 0 tools)，再发主请求 (113818B, 26 tools) | 只发一个主请求 |

**说明**: CC 的预检请求使用 `structured-outputs-2025-12-15` beta flag，主请求使用 `claude-code-20250219` + `extended-cache-ttl-2025-04-11`。预检请求的 model 是 `claude-haiku-4-5-20251001`（带日期后缀），主请求是 `claude-haiku-4-5`（不带后缀）。

---

### 8. 辅助 API 调用缺失

CC 一次会话的完整请求序列：

| 序号 | 方法 | 端点 | User-Agent |
|------|------|------|------------|
| 1 | POST | `/api/eval/sdk-{id}` | `Bun/1.3.14` |
| 2 | GET | `/v1/mcp_servers?limit=1000` | `axios/1.13.6` |
| 3 | GET | `/api/claude_cli/bootstrap?entrypoint=sdk-cli&model=...` | `claude-code/2.1.133` |
| 4 | GET | `/api/claude_code_penguin_mode` | `axios/1.13.6` |
| 5-8 | GET | `/mcp-registry/v0/servers?...` (分页) | `axios/1.13.6` |
| 6 | GET | `/api/oauth/account/settings` | `claude-code/2.1.133` |
| 7 | GET | `/api/claude_code_grove` | `claude-cli/2.1.133 (external, sdk-cli)` |
| 9 | POST | `/v1/messages?beta=true` (预检) | `claude-cli/2.1.133 (external, sdk-cli)` |
| 10 | POST | `/v1/messages?beta=true` (主请求) | `claude-cli/2.1.133 (external, sdk-cli)` |
| 12 | POST | `/api/event_logging/v2/batch` | `claude-code/2.1.133` |
| 13 | POST | Datadog 日志 | `axios/1.13.6` |

dario 只转发 `/v1/messages`，不发起任何辅助 API 调用。从服务端角度看，一个"CC 客户端"从未访问 bootstrap、grove、MCP 等端点是异常的。

---

### 9. Accept-Encoding 值可能不同

| 维度 | 真实 CC | dario (Bun fetch) |
|------|---------|-------------------|
| /v1/messages | `gzip, deflate, br, zstd` | Bun 自动生成（具体值未确认） |

**说明**: CC 的 Accept-Encoding 顺序是 `gzip, deflate, br, zstd`，注意 `deflate` 在 `br` 前面，且包含 `zstd`。Bun fetch 的默认值可能不同。dario 不控制此 header。

---

### 10. 协议版本

| 维度 | 真实 CC | dario |
|------|---------|-------|
| HTTP 协议 | HTTP/1.1 | HTTP/1.1 (Bun fetch) |

**说明**: 当前一致。CC 通过 mitmproxy 代理时仍使用 HTTP/1.1（非 HTTP/2）。之前本地版本引入的 `h2-outbound.ts` 使用 HTTP/2 反而制造了差异，已回滚。

---

## 附录: CC 不同端点使用的 User-Agent

| User-Agent | 使用端点 |
|------------|---------|
| `Bun/1.3.14` | `/api/eval/sdk-*` |
| `axios/1.13.6` | `/v1/mcp_servers`, `/mcp-registry/*`, `/api/claude_code_penguin_mode`, Datadog |
| `claude-code/2.1.133` | `/api/claude_cli/bootstrap`, `/api/oauth/account/settings`, `/api/event_logging/v2/batch` |
| `claude-cli/2.1.133 (external, sdk-cli)` | `/api/claude_code_grove`, `/v1/messages` |
