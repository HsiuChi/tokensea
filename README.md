# TokenSea

Claude Team/Max 订阅池化网关平台。将多个 Claude Team 席位或 Max 订阅统一为一个 API 服务，支持负载均衡、会话粘性、故障转移和监控。

## 架构

```
                    ┌──────────────┐
  Client ──────────►│     CPA      │──► API 分发 / 会话粘性 / 故障转移
  (API Key)         │  (cli-proxy) │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼────┐ ┌────▼─────┐ ┌────▼─────┐
        │ Dario-1  │ │ Dario-2  │ │ Dario-N  │
        │ (Seat 1) │ │ (Seat 2) │ │ (Seat N) │
        └──────────┘ └──────────┘ └──────────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────▼───────┐
                    │  Anthropic   │
                    │  API         │
                    └──────────────┘
```

- **CPA (cli-proxy-api)**：Key 分发、路由、会话粘性和故障转移。关闭自带伪装。
- **Dario**：线级保真伪装。每个 Team 席位（或 Max 订阅）运行一个独立的 dario 容器。
- **Redis**：CPA 会话缓存。
- **Prometheus + Grafana**：监控和可视化。

## Team 账号 vs Max 订阅

| 特性 | Team 席位 | Max 订阅 |
|------|----------|---------|
| 凭证粒度 | 每个用户一个 OAuth token | 每个订阅一个 OAuth token |
| 限额模型 | 组织级共享限额，每席位独立 5h/7d 窗口 | 每订阅独立限额 |
| 推荐路由策略 | `round-robin`（分散负载到各席位） | `session-affinity`（保持会话粘性） |
| representative-claim | `team` | `max-5x` 等 |
| 每节点成本 | 席位单价较低，可大量部署 | 订阅单价较高 |

## 快速开始

### 1. 前置条件

- Docker 和 Docker Compose
- 至少一个 Claude Team 席位（或 Max 订阅）

### 2. 配置凭证

```bash
# 复制环境变量模板
cp .env.example .env

# 设置账号类型
# Team 账号使用:
echo 'DARIO_ACCOUNT_TYPE=team' >> .env
# Max 订阅使用:
# echo 'DARIO_ACCOUNT_TYPE=max' >> .env

# 使用交互式脚本填入凭证
./scripts/init-credentials.sh

# 或从文件批量导入
./scripts/init-credentials.sh --file seats.csv
```

获取 Team 席位 OAuth 凭证的方法：
1. 让每个 Team 用户在自己的机器上运行 `claude login`（通过 Claude Code CLI）
2. 从每个用户的机器上提取：
   - OAuth tokens: `~/.claude/.credentials.json` → `claudeAiOauth.{accessToken, refreshToken, expiresAt}`
   - Device ID: `~/.claude/.claude.json` → `userID`
   - Account UUID: `~/.claude/.claude.json` → `oauthAccount.accountUuid`
3. 也可以用 `dario login` 替代步骤 1

### 3. 配置 CPA

编辑 `config/config.yaml`：
- `api-keys`：下游客户端使用的 API Key
- `claude-api-key`：每个 dario 节点的内部认证 Key 和地址
- `routing.strategy`：Team 推荐用 `round-robin`，Max 推荐用 `session-affinity`

### 4. 启动服务

```bash
# 构建并启动所有服务
docker compose up -d

# 仅启动特定席位
docker compose up -d dario-1

# 查看日志
docker compose logs -f dario-1
```

### 5. 验证

```bash
# 检查 dario 节点健康（返回 account_type 等信息）
curl http://localhost:3456/healthz

# 查看 Prometheus 指标（包含 account_type 标签）
curl http://localhost:3456/metricsz

# 通过 CPA 发送请求
curl -H "x-api-key: tsk-prod-key-001-change-me" \
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
| `DARIO_ACCOUNT_ID` | 席位标识（显示在 healthz 中，如 `seat-1`） | — |
| `DARIO_ACCOUNT_TYPE` | 账号类型：`team` 或 `max` | `team` |
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
| `GET /healthz` | 无 | 健康检查（JSON，含 account_type） |
| `GET /metricsz` | 无 | Prometheus 指标（含 account_type 标签） |
| `GET /health` | 无 | 简要健康状态 |
| `GET /status` | 需认证 | OAuth 状态详情 |
| `POST /v1/messages` | 需认证 | Anthropic Messages API 代理 |
| `POST /v1/chat/completions` | 需认证 | OpenAI 兼容格式代理 |

### CPA 网关

| 端点 | 说明 |
|------|------|
| `POST /v1/messages` | Anthropic Messages API |
| `GET /v1/models` | 模型列表 |

## 路由策略

### Team 账号推荐：round-robin

Team 席位共享组织级限额，轮询策略可以将请求均匀分散到各席位，最大化总吞吐量。当某个席位触发 429 时，CPA 自动切换到下一个席位。

```yaml
# config/config.yaml
routing:
  strategy: round-robin
```

### Max 订阅推荐：session-affinity

Max 订阅有独立限额，会话粘性可以保持对话的连续性（工具调用等多轮交互场景）。

```yaml
# config/config.yaml
routing:
  strategy: session-affinity
  session-affinity-ttl: 4h
```

## 扩容

```bash
# 添加新席位
./scripts/scale.sh add 4

# 移除席位
./scripts/scale.sh remove 4

# 列出所有节点
./scripts/scale.sh list

# 热重载 CPA 配置
./scripts/scale.sh reload-cpa
```

## 监控

- **Prometheus**: `http://192.204.62.165:9090`
- **Grafana**: `http://192.204.62.165:3000`（默认账号 admin/admin）

所有 Prometheus 指标都带有 `account_type` 标签，可以按 `team` 和 `max` 分别过滤和聚合。

## 运维

```bash
# 健康检查
./scripts/health-check.sh

# 持续监控
./scripts/health-check.sh --watch

# 对所有节点运行 dario doctor
./scripts/doctor-all.sh

# 查看单个席位指标
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
│   ├── init-credentials.sh  # 凭证初始化（支持 Team/Max）
│   ├── scale.sh             # 动态扩容
│   ├── health-check.sh      # 健康检查
│   └── doctor-all.sh        # 批量诊断
├── docker-compose.yml
├── .env.example
└── README.md
```
