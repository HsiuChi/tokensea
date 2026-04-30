# TokenSea 技术架构文档

## 一、项目概述

TokenSea 是一个基于 Claude Team/Max 订阅的 API 网关平台，核心目标是将几十上百个 Max 订阅池化为统一的 API 服务，通过自定义 API Key 分发给 100+ 团队成员使用。

### 核心设计原则

- **伪装层与分发层解耦**：dario 负责线级保真伪装，cpa 负责 Key 分发与路由
- **用户级绑定**：路由粒度为"用户"而非"对话"，简化逻辑
- **最轻负载分配**：新用户绑定当前最空闲的 dario 节点
- **故障自动迁移**：账号异常时自动将用户迁移到健康节点
- **不限制用户**：用户无并发限制、无 token 配额限制，额度由 Max 账号池总量保证

### 技术选型

| 组件 | 选型 | 理由 |
|------|------|------|
| **分发与路由层** | cpa (CLIProxyAPI) | 原生支持 OAuth Token 管理、多账号池、会话粘性、Key 分发、故障转移；Go 实现，生产级稳定 |
| **伪装层** | dario | 线级保真（6 轴），实时模板提取，TLS 指纹匹配，CCH 签名；目前最高精度的 Claude Code 请求伪装 |
| **为什么不选 sub2api** | — | 伪装逻辑与业务耦合，需要大量魔改；自带伪装不如 dario 精细；OAuth 管理不如 cpa 成熟 |
| **为什么不选 new-api** | — | 不支持 OAuth Token，只能转 API Key，无法对接 Max 订阅 |
| **为什么 cpa + dario 而非 cpa 独立** | — | cpa 自带伪装但不是线级保真（无 header 顺序、body 字段顺序、TLS 指纹等）；账号多则单账号压力低，但伪装精度是最稳的保障 |

---

## 二、整体架构

```
┌──────────────────────────────────────────────────────────┐
│                     用户 (100+)                           │
│  Claude Code / Cursor / Cline / Aider / 自研工具          │
│  ANTHROPIC_API_KEY=sk-team-xxx                           │
│  ANTHROPIC_BASE_URL=https://api.your-company.com         │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│                cpa (CLIProxyAPI) — 分发与路由层            │
│                                                          │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐           │
│  │ API Key    │ │ 用户/分组   │ │ 协议转换    │           │
│  │ 分发与管理  │ │ 权限管理    │ │ OpenAI↔Anth │           │
│  └────────────┘ └────────────┘ └────────────┘           │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐           │
│  │ 多账号池    │ │ 会话粘性    │ │ 故障转移    │           │
│  │ 负载均衡    │ │ 用户级绑定  │ │ 429/403处理 │           │
│  └────────────┘ └────────────┘ └────────────┘           │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐           │
│  │ Dashboard  │ │ 审计日志    │ │ OAuth Token │           │
│  │ Web 管理   │ │ 用量统计    │ │ 凭证管理    │           │
│  └────────────┘ └────────────┘ └────────────┘           │
│                                                          │
│  ⚠️ 关闭 cpa 自带的 Claude Code 伪装（由 dario 负责）     │
└────────┬──────────────┬──────────────┬───────────────────┘
         │              │              │
         ▼              ▼              ▼
   ┌───────────┐  ┌───────────┐  ┌───────────┐
   │ dario-1   │  │ dario-2   │  │ dario-N   │
   │ max-1     │  │ max-2     │  │ max-N     │
   │           │  │           │  │           │
   │ Bun 运行时 │  │ Bun 运行时 │  │ Bun 运行时 │
   │ 线级保真   │  │ 线级保真   │  │ 线级保真   │
   │ OAuth 自管 │  │ OAuth 自管 │  │ OAuth 自管 │
   │ TLS 指纹   │  │ TLS 指纹   │  │ TLS 指纹   │
   └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
         │              │              │
         └──────────────┼──────────────┘
                        ▼
                 api.anthropic.com
       (以为是 N 个正常的 Claude Code 用户)
```

### 两层职责划分

| 层 | 组件 | 职责 | 不做什么 |
|---|---|---|---|
| **分发与路由** | cpa | Key 分发、用户管理、负载均衡、会话粘性、故障转移、协议转换、Dashboard、OAuth 凭证管理 | 不做请求伪装 |
| **线级保真** | dario | 请求伪装、OAuth Token 注入与刷新、模板提取与同步、TLS 指纹匹配、CCH 签名、节奏控制 | 不做 Key 分发、不做用户管理 |

---

## 三、各层详细设计

### 3.1 Dario 伪装集群层

#### 3.1.1 职责

将出站请求伪装为标准 Claude Code CLI 请求，确保 Anthropic 将其识别为 Max 订阅的正常使用，而非第三方 API 调用。

#### 3.1.2 核心技术：线级保真 (Wire-Level Fidelity)

dario 在 Anthropic 可观察的所有维度上与真实 Claude Code 保持一致：

| 轴 | 实现方式 | 为什么重要 |
|---|---|---|
| **请求体字段顺序** | 从捕获的 CC 模板中提取 `body_field_order`，按原始顺序重排 JSON 字段 | JSON 无序但线上有序，顺序不同 = 指纹异常 |
| **TLS 指纹** | 使用 Bun 运行时（BoringSSL），与 CC 二进制一致；自动检测并重启 | CC 是 Bun 编译的，Node 的 OpenSSL 产生不同 JA3/JA4 哈希 |
| **请求间时序** | 可调最小间隔 + 随机抖动，模拟人类操作节奏 | 固定间隔 = 机器行为 = 可检测 |
| **流消费塑形** | 客户端断开后仍排空上游 SSE 流，与 CC 行为一致 | CC 会读完流再断开，不读 = 行为异常 |
| **Session ID 生命周期** | 空闲轮换 + 抖动 + 硬上限 + 按客户端隔离 | 永不轮换或轮换太规律 = 可关联 |
| **Header 顺序** | 从 CC 捕获 `rawHeaders`，按原始插入顺序重建 | HTTP 头顺序是指纹，`Headers` 对象会字母排序 |

#### 3.1.3 实时模板提取 (MITM Capture)

dario 不硬编码请求格式，而是从本地安装的 Claude Code 二进制中实时提取：

```
1. 启动临时 HTTP 服务器（随机环回端口）
2. 启动 claude --print -p 'hi'，ANTHROPIC_BASE_URL 指向临时服务器
3. 捕获 CC 发出的完整请求：headers（含顺序）、body（含字段顺序）、tools、system prompt
4. 返回最小有效 SSE 流让 CC 正常退出
5. 模板缓存到 ~/.dario/cc-template.live.json，24 小时 TTL
6. CC 更新后自动检测版本漂移，触发后台刷新
```

提取的模板包括：

| 内容 | 用途 |
|------|------|
| `system[1]` agent_identity | "You are Claude Code..." 身份声明 |
| `system[2]` system_prompt | CC 完整系统提示（~25KB） |
| `body.tools` | CC 原生工具定义 |
| `rawHeaders` → `header_order` | HTTP 头的精确发送顺序 |
| `anthropic-beta` | 完整的 beta flag 集合 |
| `Object.keys(body)` → `body_field_order` | JSON body 字段顺序 |
| `x-anthropic-billing-header` | 计费头格式和版本 |

OAuth 配置（Client ID、authorize URL、token URL）同样从 CC 二进制字节中自动检测，不硬编码。Anthropic 轮换 Client ID 后 dario 自动适配。

#### 3.1.4 请求伪装流程

```
cpa 转发来的原始请求
  │
  ├── 替换认证: x-api-key → OAuth Bearer Token
  ├── 模板注入:
  │   ├── system[0]: 计费属性块 (cc_version + cch 签名)
  │   ├── system[1]: agent_identity ("You are Claude Code...")
  │   └── system[2]: CC 完整系统提示
  ├── 原始 system prompt → 移入第一条 user message 的 <system_instructions> 中
  ├── tools 替换为 CC 原生工具集
  ├── Header 重建: 按捕获的 header_order 排列
  │   ├── User-Agent: claude-cli/<version>
  │   ├── anthropic-beta: claude-code-20250219,oauth-2025-04-20,...
  │   ├── X-Stainless-*: 模拟 Node.js SDK
  │   ├── X-App: cli
  │   └── X-Claude-Code-Session-Id: 随机 UUID
  ├── Body 字段重排: 按捕获的 body_field_order
  ├── 注入 metadata.user_id: 账号 UUID + 客户端 ID
  ├── CCH 签名: xxhash64(request_body, seed) → 嵌入计费头
  ├── 节奏控制: pacing delay + 随机抖动
  │
  ▼
api.anthropic.com (认为是正常的 Claude Code 请求)
```

#### 3.1.5 dario-node 容器化

```dockerfile
FROM oven/bun:1 AS runtime

# 安装 claude code CLI（模板提取需要）
RUN npm install -g @anthropic-ai/claude-code

# 安装改造后的 dario
COPY --from=dario-build /app/dist /app/dist
COPY --from=dario-build /app/package.json /app/

# 每个 Max 账号一个实例
ENV DARIO_OAUTH_ACCESS_TOKEN=""
ENV DARIO_OAUTH_REFRESH_TOKEN=""
ENV DARIO_OAUTH_EXPIRES_AT=""
ENV DARIO_ACCOUNT_ID=""
ENV DARIO_LISTEN_PORT=3456
ENV DARIO_LISTEN_HOST=0.0.0.0
ENV DARIO_API_KEY=""          # 内部认证 Key，cpa 调用时使用

# Bun 运行时保证 TLS 指纹与 Claude Code 一致
CMD ["bun", "run", "/app/dist/server.js"]
```

#### 3.1.6 改造项（原版 dario → 服务化）

| 改造项 | 原版 | 改造后 |
|--------|------|--------|
| 凭证来源 | 读本地 `~/.claude/.credentials.json` | 环境变量注入 + 自动读取 |
| 多账号 | 本地文件池 | 单实例单账号，集群化 |
| 模板管理 | 本地缓存 24h | 共享存储 + 漂移检测 + 自动刷新 |
| 监控 | `dario doctor` CLI | HTTP `/health` + `/metrics` 端点 |
| 网络 | 仅 localhost | `0.0.0.0` + 内部 API Key 认证 |
| 日志 | 本地文件 | 结构化 JSON 日志 |
| Token 刷新 | 本地自动刷新 | 保持，增加刷新失败上报给 cpa |

#### 3.1.7 健康与指标端点

```
GET /health
{
  "status": "healthy",
  "account_id": "max-account-A",
  "oauth_expires_at": "2026-04-30T18:00:00Z",
  "template_version": "2.1.92",
  "template_age_hours": 4,
  "runtime": "bun-match",          // 必须是 bun-match
  "concurrent_requests": 3,
  "max_concurrent": 5
}

GET /metrics
{
  "utilization_5h": 0.45,
  "utilization_7d": 0.62,
  "available_capacity": 0.55,
  "total_requests": 1234,
  "failed_requests": 5,
  "last_429_at": "2026-04-30T15:30:00Z",
  "template_drift": false          // CC 更新但模板未刷新时为 true
}
```

---

### 3.2 cpa 分发与路由层

#### 3.2.1 职责

管理下游 API Key 分发、多 dario 节点负载均衡、会话粘性、故障转移、协议转换和运营管理。

#### 3.2.2 核心能力（cpa 原生支持，无需自研）

| 能力 | cpa 实现 | 说明 |
|------|---------|------|
| **API Key 分发** | `api-keys` 配置 + Management API | 每个 Key 可绑定模型范围、代理、前缀路由 |
| **多账号池** | Round-robin / Fill-first / Session affinity | 三种路由策略可选 |
| **会话粘性** | 基于 session_id / user_id / conversation_id / 消息哈希 | 多种 session ID 来源，可配 TTL |
| **故障转移** | 可配置重试次数 + 冷却调度 + 自动换号 | 指数退避，可配最大重试账号数 |
| **协议转换** | OpenAI ↔ Anthropic ↔ Gemini 双向转换 | 用户用什么格式都行 |
| **OAuth 凭证管理** | 完整 OAuth 生命周期 + 自动刷新 + 多存储后端 | 文件 / PostgreSQL / Git / S3 |
| **Dashboard** | Web 管理 UI + 桌面 GUI (EasyCLI) | 凭证、用量、日志、OAuth 流程 |
| **429 智能处理** | 冷却调度 + 换号 + 换模型 + Antigravity 兜底 | 多层降级策略 |

#### 3.2.3 关键配置：关闭 cpa 自带伪装

cpa 原生支持 Claude Code 请求伪装（UA 伪造、CCH 签名、敏感词混淆等），但在本架构中由 dario 负责伪装，需要关闭 cpa 的伪装功能以避免双重处理：

```yaml
# cpa 配置: 关闭 Claude Code 伪装
claude:
  cloak-mode: never              # 关闭伪装 (auto/always/never)
  experimental-cch-signing: false # 关闭 CCH 签名
  sensitive-word-obfuscation: false # 关闭敏感词混淆
```

#### 3.2.4 dario 节点作为 cpa 上游

cpa 将每个 dario 节点配置为一个独立的 "credential"（上游渠道）：

```yaml
# cpa 配置: dario 节点作为上游
credentials:
  - name: "dario-max-1"
    provider: claude              # Claude 协议
    base-url: "http://dario-1:3456"  # dario 节点地址
    api-key: "${DARIO_INTERNAL_KEY}" # dario 内部认证 Key
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"]
    routing:
      priority: 10               # 优先级

  - name: "dario-max-2"
    provider: claude
    base-url: "http://dario-2:3456"
    api-key: "${DARIO_INTERNAL_KEY}"
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"]
    routing:
      priority: 8

  # ... 更多 dario 节点
```

#### 3.2.5 路由策略：会话粘性 + 负载均衡

```yaml
# cpa 配置: 路由策略
routing:
  strategy: session-affinity       # 会话粘性路由
  session-ttl: 24h                 # 粘性绑定 24 小时
  session-id-source:               # session ID 来源优先级
    - "metadata.user_id"           # 1. 请求体中的 user_id
    - "X-Session-ID"              # 2. 自定义 Header
    - "x-api-key"                 # 3. API Key 本身（最可靠）
  fallback-strategy: round-robin   # 无粘性时按轮询分配
  retry:
    max-retries: 3                 # 最多重试 3 个不同节点
    retry-interval: 2s             # 重试间隔
    cooldown-base: 2m              # 429 冷却基础时间
    cooldown-max: 32m              # 冷却最长时间
```

#### 3.2.6 API Key 分发配置

```yaml
# cpa 配置: 下游 API Key
api-keys:
  - key: "sk-team-frontend"       # 前端团队
    models: ["claude-sonnet-4-6"]
    excluded-models: ["claude-opus-4-6"]  # 前端不需要 Opus

  - key: "sk-team-backend"        # 后端团队
    models: ["claude-sonnet-4-6", "claude-opus-4-6"]

  - key: "sk-team-ai"             # AI 团队
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"]

  - key: "sk-team-admin"          # 管理员
    models: ["*"]                  # 所有模型
```

#### 3.2.7 故障转移机制

cpa 原生支持多层故障转移，在本架构中：

```
场景 1: dario 节点 429
━━━━━━━━━━━━━━━━━━━━━
  → cpa 自动标记该 credential 冷却
  → 同一请求重试其他 dario 节点
  → 冷却期: 2min → 4min → 8min → 16min → 32min（指数退避）
  → 冷却结束后自动恢复

场景 2: dario 节点不可用（健康检查失败）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  → cpa 自动剔除该 credential
  → 新请求路由到健康节点
  → 粘性会话自动迁移到新节点

场景 3: Max 账号被封（dario 返回 403）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  → cpa 标记该 credential 为 failed
  → 不再往该节点路由
  → 所有绑定该节点的用户自动迁移
  → 告警通知管理员

场景 4: OAuth Token 过期
━━━━━━━━━━━━━━━━━━━━━━━
  → dario 自动刷新（dario 内置机制）
  → 刷新失败 → dario 返回 401 → cpa 同场景 2 处理
```

#### 3.2.8 协议转换

cpa 原生支持多协议，团队成员可以自由选择：

```
用户发送 Anthropic 格式:
  POST /v1/messages
  → cpa 识别 → 转发到 dario → dario 伪装 → Anthropic

用户发送 OpenAI 格式:
  POST /v1/chat/completions
  → cpa 转换为 Anthropic 格式 → 转发到 dario → dario 伪装 → Anthropic
  → 响应转回 OpenAI 格式

用户发送 Gemini 格式:
  POST /v1beta/models/...
  → cpa 转换 → dario → Anthropic
```

---

## 四、完整请求链路

```
1. 用户请求
   POST https://api.your-company.com/v1/messages
   x-api-key: sk-team-backend
   {"model": "claude-sonnet-4-6", "messages": [...]}

2. cpa 认证
   验证 sk-team-backend → 识别团队/权限 → 允许访问 sonnet + opus

3. cpa 路由（会话粘性）
   a. 提取 session_id (来自 x-api-key 或 metadata.user_id)
   b. 查找粘性绑定 → 之前绑定了 dario-max-17
   c. 检查 dario-max-17 是否健康 → 健康 → 走 dario-17

4. cpa 转发（不做伪装）
   POST http://dario-17:3456/v1/messages
   {"model": "claude-sonnet-4-6", "messages": [...]}  ← 原始请求

5. dario-17 线级保真伪装
   a. 替换认证: x-api-key → OAuth Bearer Token (自动刷新)
   b. 模板注入: system prompt + tools + billing header
   c. Header 重建: 按捕获的 header_order 排列
   d. Body 字段重排: 按捕获的 body_field_order
   e. CCH 签名计算并嵌入
   f. 节奏控制: pacing delay + 抖动
   g. metadata.user_id 注入

6. 发到 Anthropic
   POST https://api.anthropic.com/v1/messages
   (Anthropic 认为这是一个正常的 Claude Code 用户)

7. 响应回传
   Anthropic → dario (SSE) → cpa → 用户
   cpa 提取 token 用量 → 记录审计日志

8. 异常处理
   步骤 5 收到 429:
     → dario 内部重试（已有机制）
     → 失败 → 返回 429 给 cpa
     → cpa 标记 dario-max-17 冷却
     → cpa 重试另一个 dario 节点

   步骤 5 收到 403（账号被封）:
     → dario 返回 403 给 cpa
     → cpa 标记 dario-max-17 failed
     → 后续请求不再路由到该节点
     → 告警通知管理员
```

---

## 五、部署架构

### 5.1 Docker Compose

```yaml
services:
  # ─── cpa 分发与路由 ───
  cpa:
    image: cli-proxy-api:latest
    ports:
      - "8080:8080"               # 用户入口
      - "3000:3000"               # Dashboard
    volumes:
      - ./cpa-config:/config
      - cpa-auths:/auths          # OAuth 凭证存储
    environment:
      CPA_CONFIG: /config/config.yaml
      CPA_AUTH_DIR: /auths
    depends_on:
      - redis

  # ─── Dario 伪装集群 ───
  dario-1:
    build: ./dario-modified
    environment:
      DARIO_OAUTH_ACCESS_TOKEN: ${MAX_1_TOKEN}
      DARIO_OAUTH_REFRESH_TOKEN: ${MAX_1_REFRESH}
      DARIO_OAUTH_EXPIRES_AT: ${MAX_1_EXPIRY}
      DARIO_ACCOUNT_ID: max-1
      DARIO_API_KEY: ${DARIO_INTERNAL_KEY}
      DARIO_LISTEN_PORT: "3456"
      DARIO_LISTEN_HOST: "0.0.0.0"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3456/health"]
      interval: 30s
    deploy:
      resources:
        limits:
          memory: 512M

  dario-2:
    build: ./dario-modified
    environment:
      DARIO_OAUTH_ACCESS_TOKEN: ${MAX_2_TOKEN}
      DARIO_OAUTH_REFRESH_TOKEN: ${MAX_2_REFRESH}
      DARIO_OAUTH_EXPIRES_AT: ${MAX_2_EXPIRY}
      DARIO_ACCOUNT_ID: max-2
      DARIO_API_KEY: ${DARIO_INTERNAL_KEY}
      DARIO_LISTEN_PORT: "3456"
      DARIO_LISTEN_HOST: "0.0.0.0"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3456/health"]
      interval: 30s
    deploy:
      resources:
        limits:
          memory: 512M

  # ... 更多 dario-node (每个 Max 账号一个)

  # ─── 基础设施 ───
  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data

  # ─── 监控 ───
  prometheus:
    image: prom/prometheus
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    ports:
      - "3001:3000"

volumes:
  cpa-auths:
  redisdata:
```

### 5.2 cpa 配置文件

```yaml
# config.yaml — cpa 完整配置

server:
  port: 8080
  base-url: "https://api.your-company.com"

# ─── 下游 API Key ───
api-keys:
  - key: "sk-team-frontend"
    models: ["claude-sonnet-4-6", "claude-haiku-4-5"]
  - key: "sk-team-backend"
    models: ["claude-sonnet-4-6", "claude-opus-4-6"]
  - key: "sk-team-ai"
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"]
  - key: "sk-team-admin"
    models: ["*"]

# ─── 上游 dario 节点 ───
credentials:
  - name: "dario-max-1"
    provider: claude
    base-url: "http://dario-1:3456"
    api-key: "${DARIO_INTERNAL_KEY}"
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"]
    routing:
      priority: 10

  - name: "dario-max-2"
    provider: claude
    base-url: "http://dario-2:3456"
    api-key: "${DARIO_INTERNAL_KEY}"
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"]
    routing:
      priority: 8

  # ... 更多节点

# ─── 路由策略 ───
routing:
  strategy: session-affinity
  session-ttl: 24h
  session-id-source:
    - "x-api-key"
    - "metadata.user_id"
    - "X-Session-ID"
  fallback-strategy: round-robin
  retry:
    max-retries: 3
    retry-interval: 2s
    max-retry-credentials: 3
    cooldown-base: 2m
    cooldown-max: 32m

# ─── 关闭 cpa 自带伪装（由 dario 负责）───
claude:
  cloak-mode: never
  experimental-cch-signing: false
  sensitive-word-obfuscation: false

# ─── 日志 ───
logging:
  level: info
  format: json
  request-logging: true
```

### 5.3 规模估算

```
假设:
  - 团队 100+ 用户
  - 每个_Max 账号并发约 5
  - 每个 Max 账号日处理 ~200K token

部署:
  - 50-100 个 Max 账号
  - 50-100 个 dario-node 容器
  - 1 个 cpa 实例
  - 1 个 Redis
  - 监控套件

资源需求:
  - 每个 dario-node: ~256-512MB 内存 (Bun 运行时)
  - cpa: ~256MB 内存 (Go，轻量)
  - 50 个 dario 节点总计: ~25GB 内存
  - 推荐部署: 2-3 台 16GB 服务器，或 K8s 集群

成本:
  - 50 个 Max 账号 × $200/月 = $10,000/月
  - 对比官方 API: 100 人重度使用可能 $20,000-50,000/月
  - 服务器成本: ~$500/月
```

---

## 六、监控告警

### 6.1 关键指标

| 指标 | 来源 | 说明 |
|------|------|------|
| dario-node 健康状态 | `/health` | runtime 是否 bun-match，OAuth 是否有效 |
| dario-node 余量 | `/metrics` | util5h / util7d |
| 模板漂移 | `/metrics` | CC 更新但模板未刷新 |
| cpa 路由分布 | cpa 日志 | 各 dario 节点请求量 |
| 请求成功率 | cpa | 非 429/5xx 的比例 |
| 429 率 | cpa | 所有节点的 429 比例 |
| 端到端延迟 | cpa | 用户 → 响应的时间 |
| OAuth Token 有效期 | dario `/health` | 剩余秒数 |

### 6.2 告警规则

| 规则 | 条件 | 级别 |
|------|------|------|
| dario-node down | 健康检查连续 3 次失败 | 严重 |
| runtime 不是 bun-match | `/health` 中 runtime ≠ bun-match | 严重 |
| Token 即将过期 | < 1 小时且刷新失败 | 严重 |
| 账号被封 | dario 返回 403 | 严重 |
| 模板漂移 | CC 更新后模板 > 24h 未刷新 | 警告 |
| 429 率过高 | > 10% | 警告 |
| 节点余量低 | util5h > 90% | 警告 |
| 负载不均 | 最忙/最闲节点并发比 > 5x | 信息 |

---

## 七、落地计划

### Phase 1: 最小可用 (1-2 周)

- dario 改造：凭证环境变量注入 + HTTP API + 健康端点 + 服务化
- cpa 配置：dario 节点作为上游 + 关闭伪装 + 会话粘性
- 2-3 个 Max 账号验证完整链路
- 基本的 Dashboard 和健康检查

### Phase 2: 生产就绪 (2-3 周)

- dario 容器化（Bun 运行时 + TLS 指纹验证）
- 全量故障转移验证（429 / Token 过期 / 账号被封）
- 监控和告警（Prometheus + Grafana）
- 10-20 个 Max 账号
- API Key 按团队分组分发

### Phase 3: 规模化运营 (持续)

- 50-100 个 Max 账号 + 对应 dario 节点
- 自动扩缩容（根据负载动态加减 dario-node）
- 模板自动更新（CC 更新时自动重新捕获）
- 完整审计和用量分析
- 高可用：cpa 多实例 + Redis Sentinel

---

## 八、风险与应对

| 风险 | 说明 | 应对 |
|------|------|------|
| ToS 违规 | Max 订阅为个人用途，转售/共享明确违规 | 了解风险，准备官方 API 降级方案 |
| 账号被封 | 异常用量模式被检测 | dario 线级保真降低检测风险 + 预留冗余账号 |
| 伪装失效 | Anthropic 加强第三方检测 | dario 实时模板提取 + 自动适配 + 社区跟进 |
| dario 节点宕机 | 进程崩溃 / 容器重启 | cpa 自动故障转移 + 健康检查 + 自动重启 |
| Token 泄露 | OAuth Token 等于 Max 订阅完全访问权 | 内部网络隔离 + dario API Key 认证 + 不暴露到公网 |
| 猫鼠游戏 | 伪装与检测持续对抗 | 关注 dario 社区更新，及时跟进 |
| TLS 指纹不匹配 | dario 节点在 Node 下运行而非 Bun | 健康检查检测 runtime 类型，非 bun-match 则告警 |
| 模板过时 | CC 更新后请求格式变化 | dario 漂移检测 + 24h 自动刷新 + 手动 `dario doctor` |
