# TokenSea

个人 Claude Max 订阅统一管理工具。将你自己的多个 Claude Max 订阅整合为一个 API 服务，方便在 Claude Code、Hermes 等不同客户端中统一使用自己的订阅额度。

**仅供个人非商业用途。** 所有订阅均为本人持有，本工具仅用于在个人设备/Agent 之间统一管理自己的订阅，不涉及任何转售、共享或商业行为。

## 架构

```
                    ┌──────────────┐
  Client ──────────►│     CPA      │──► 请求路由 / 会话粘性 / 故障转移
  (API Key)         │  (cli-proxy) │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼────┐ ┌────▼─────┐ ┌────▼─────┐
        │ Dario-1  │ │ Dario-2  │ │ Dario-N  │
        │ (Sub 1)  │ │ (Sub 2)  │ │ (Sub N)  │
        └──────────┘ └──────────┘ └──────────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────▼───────┐
                    │  Anthropic   │
                    │  API         │
                    └──────────────┘
```

- **CPA (cli-proxy-api)**：请求路由、会话粘性和故障转移。关闭自带伪装。
- **Dario**：线级保真代理。每个 Max 订阅运行一个独立的 dario 容器，确保请求特征与真实 Claude Code 一致。
- **Redis**：CPA 会话缓存。
- **Prometheus + Grafana**：监控和可视化。

## 快速开始

### 1. 前置条件

- Docker 和 Docker Compose
- 至少一个 Claude Max 订阅（本人持有）

### 2. 配置凭证

```bash
# 复制环境变量模板
cp .env.example .env

# 使用交互式脚本填入凭证
./scripts/init-credentials.sh
```

获取 OAuth 凭证的方法：
1. 在自己的机器上运行 `claude login`（通过 Claude Code CLI）
2. 从本地提取：
   - OAuth tokens: `~/.claude/.credentials.json` → `claudeAiOauth.{accessToken, refreshToken, expiresAt}`
   - Device ID: `~/.claude/.claude.json` → `userID`
   - Account UUID: `~/.claude/.claude.json` → `oauthAccount.accountUuid`
3. 也可以用 `dario login` 替代步骤 1

### 3. 配置 CPA

编辑 `config/config.yaml`：
- `api-keys`：你个人使用的 API Key
- `claude-api-key`：每个 dario 节点的内部认证 Key 和地址
- `routing.strategy`：推荐 `session-affinity`（保持会话粘性）

### 4. 启动服务

```bash
# 构建并启动所有服务
docker compose up -d

# 仅启动特定订阅节点
docker compose up -d dario-1

# 查看日志
docker compose logs -f dario-1
```

### 5. 验证

```bash
# 检查 dario 节点健康
curl http://localhost:3456/healthz

# 查看 Prometheus 指标
curl http://localhost:3456/metricsz

# 通过 CPA 发送请求
curl -H "x-api-key: your-personal-key" \
  -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"hi"}],"max_tokens":100}' \
  http://localhost:8080/v1/messages

# 批量健康检查
./scripts/health-check.sh
```

## 环境变量

### Dario 节点环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DARIO_OAUTH_ACCESS_TOKEN` | OAuth 访问令牌 | — |
| `DARIO_OAUTH_REFRESH_TOKEN` | OAuth 刷新令牌 | — |
| `DARIO_OAUTH_EXPIRES_AT` | 令牌过期时间（毫秒时间戳） | `0` |
| `DARIO_OAUTH_SCOPES` | OAuth 权限范围（逗号分隔） | `user:inference` |
| `DARIO_DEVICE_ID` | 设备 ID（来自 .claude.json 的 userID） | — |
| `DARIO_ACCOUNT_UUID` | 账号 UUID | — |
| `DARIO_ACCOUNT_ID` | 订阅标识（显示在 healthz 中，如 `sub-1`） | — |
| `DARIO_API_KEY` | 内部认证 Key | — |
| `DARIO_HOST` | 监听地址 | `0.0.0.0` |
| `DARIO_LISTEN_PORT` | 监听端口 | `3456` |
| `DARIO_CC_VERSION` | CC 版本（容器内无 CC CLI 时使用） | `2.1.100` |
| `DARIO_TEMPLATE_PATH` | 外部模板文件路径 | — |
| `DARIO_NO_LIVE_CAPTURE` | 禁用实时指纹捕获（`1`=禁用） | `0` |

## 端点

### Dario 节点

| 端点 | 认证 | 说明 |
|------|------|------|
| `GET /healthz` | 无 | 健康检查（JSON） |
| `GET /metricsz` | 无 | Prometheus 指标 |
| `GET /health` | 无 | 简要健康状态 |
| `GET /status` | 需认证 | OAuth 状态详情 |
| `POST /v1/messages` | 需认证 | Anthropic Messages API 代理 |
| `POST /v1/chat/completions` | 需认证 | OpenAI 兼容格式代理 |

### CPA 网关

| 端点 | 说明 |
|------|------|
| `POST /v1/messages` | Anthropic Messages API |
| `GET /v1/models` | 模型列表 |
| `GET /management.html` | CPA 管理面板（需 secret-key 登录） |

## 路由策略

推荐使用 `session-affinity`（会话粘性），保持对话的连续性，适合工具调用等多轮交互场景。

```yaml
# config/config.yaml
routing:
  strategy: session-affinity
  session-affinity-ttl: 4h
```

如有多个订阅并希望分散负载，也可以使用 `round-robin`：

```yaml
# config/config.yaml
routing:
  strategy: round-robin
```

## 添加/移除订阅节点

```bash
# 添加新订阅节点
./scripts/scale.sh add 4

# 移除订阅节点
./scripts/scale.sh remove 4

# 列出所有节点
./scripts/scale.sh list

# 热重载 CPA 配置
./scripts/scale.sh reload-cpa
```

## 监控

- **Prometheus**: `http://192.204.62.165:9090`
- **Grafana**: `https://api.0xt.us/grafana/`（默认账号 admin/admin）

## 运维

```bash
# 健康检查
./scripts/health-check.sh

# 持续监控
./scripts/health-check.sh --watch

# 对所有节点运行 dario doctor
./scripts/doctor-all.sh

# 查看单个节点指标
curl http://localhost:3456/metricsz
```

## 部署到远程服务器

```bash
# 同步到服务器
rsync -avz ./ lisa:~/tokensea/

# SSH 到服务器启动
ssh lisa
cd tokensea
docker compose up -d
```

## 目录结构

```
tokensea/
├── config/
│   └── config.yaml          # CPA 配置（含路由策略）
├── dario-modified/          # 改造后的 dario 源码
│   ├── Dockerfile
│   ├── build.sh
│   └── src/
├── monitoring/
│   ├── prometheus.yml
│   └── grafana/dashboards/
├── scripts/
│   ├── init-credentials.sh  # 凭证初始化
│   ├── scale.sh             # 动态扩容
│   ├── health-check.sh      # 健康检查
│   └── doctor-all.sh        # 批量诊断
├── docker-compose.yml
├── .env.example
└── README.md
```
