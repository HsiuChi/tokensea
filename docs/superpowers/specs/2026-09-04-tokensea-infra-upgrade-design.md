# TokenSea 基础设施层升级设计

**日期**: 2026-09-04
**范围**: tokensea 基础设施层（CPA + dario + docker-compose + 运维脚本）
**不在范围**: tokensea-platform（SaaS 平台）、tokensea-website

---

## 一、背景与动机

当前基础设施层三个组件全部落后于上游：

| 组件 | 当前版本 | 上游版本 | 差距 |
|------|---------|---------|------|
| CPA (CLIProxyAPI) | v6.9（config 注释），镜像 `:latest` | v7.2.149 | config 未用上 7.x 新特性 |
| dario | v3.32.2（`@askalf/dario`，maxTested CC 2.1.123） | v6.0.17 | 断代级落后，CC 模板差 136 个版本 |
| codex-dario | v1.0.0（手搓，maxTested `99.0.0`） | — | 上游 dario v6 已原生支持 Codex |

两个驱动因素：

1. **封号严重**：线级检测在生效，dario 的 TLS 指纹 + body 字段顺序保真是当前唯一护城河，不能砍。
2. **要接 Codex/GPT 反代**：上游 dario v6 已原生支持 Claude + Codex 订阅 + 自动 failover，本地 `codex-dario/` 冗余。

---

## 二、核心决策

| # | 决策 | 选择 |
|---|------|------|
| 1 | CPA 镜像 tag | pin 到 `v7.2.149`（不再 `:latest`） |
| 2 | dario 改造版来源 | fork 上游 `askalf/dario` v6.0.17，在 fork 上加外壳层，保留 git 历史 |
| 3 | tls-shim / Node24 / tshark | 全部退役（v6 用 Bun 原生 TLS，不需 Go+utls shim） |
| 4 | codex-dario 目录 | 退役，Codex 凭证迁移到 dario v6 原生格式 |
| 5 | 部署节奏 | 本地单节点验证 → 上 lisa 生产，分阶段 |
| 6 | tokensea-platform | 本轮不动 |

---

## 三、目标架构（升级后）

```
用户 ──► cpa v7.2.149 ──► dario-v6 (单容器, Claude+Codex) ──► api.anthropic.com / api.openai.com
        (分发/路由/协议转换)    (线级保真 + 账号内 failover)
```

### 关键变化

- **dario 容器**: 从"只服务 Claude"升级为"同时服务 Claude + Codex"，账号内自动 failover
- **tls-shim 退役**: 上游 v6 直接用 Bun 运行时匹配 CC 的 BoringSSL ClientHello（JA3/JA4），不再需要 Go+utls 旁路 shim
- **codex-dario 退役**: 整个 `codex-dario/` 目录删除，docker-compose 中 `codex-dario-1` 服务移除
- **CPA config 补全**: 用上 7.x 的 session-affinity-subagents、fingerprint-profile、stream-bootstrap-buffering 等

### 两层职责（不变）

| 层 | 组件 | 职责 |
|---|------|------|
| 分发与路由 | cpa v7.2.149 | API Key 分发、用户/团队权限、协议转换、会话粘性、故障转移、Dashboard |
| 线级保真 | dario v6.0.17 | Claude+Codex 伪装、OAuth 自管、TLS 指纹、模板自动跟版、账号内 failover |

---

## 四、组件详细设计

### 4.1 CPA 升级（config/config.yaml）

基于上游 `config.example.yaml`（v7.2.x），保留现有业务字段，补全 7.x 新能力。

**新增/修改字段**：

```yaml
# 镜像 pin
# docker-compose: eceasy/cli-proxy-api:v7.2.149

# 顶层关闭所有 Claude 伪装（由 dario 负责）—— 替代每条 claude-api-key 写 cloak.mode
disable-claude-cloak-mode: true

routing:
  strategy: "round-robin"
  session-affinity: true
  session-affinity-ttl: "4h"
  session-affinity-subagents: true   # 新增：子 agent 继承父会话上游绑定

# 重试语义升级（v7.x request-retry 是"额外轮次"）
request-retry: 3
max-retry-credentials: 0            # 0=全部可用（原写死 3）
max-retry-interval: 30
disable-cooling: false

# Codex 行为
codex:
  stream-bootstrap-buffering: true  # 握手帧缓冲，让 503 透明换号
  disable-codex-cloaking: true      # Codex 伪装也交给 dario
```

**claude-api-key/codex-api-key** 结构保留，但 cloak.mode 字段可移除（由顶层 disable-claude-cloak-mode 统一管理）。

### 4.2 dario 升级（dario-modified/ → fork 上游 v6.0.17）

#### 4.2.1 Fork 策略

- 在 GitHub fork `askalf/dario` → `zhangxiuqi/dario`（或组织名）
- 本地 `dario-modified/` 改为 clone 该 fork，保留 git 历史
- 改造层（entrypoint/Dockerfile）作为 fork 上的少量 commit，便于 `git pull` 跟版

#### 4.2.2 退役的外壳层

| 原外壳 | 去留 | 原因 |
|--------|------|------|
| `tls-shim/`（Go+utls 二进制） | 删 | v6 用 Bun 原生 TLS |
| `entrypoint.sh` 中启动 tls-shim 的逻辑 | 删 | 同上 |
| `Dockerfile` 中 Go shim 构建阶段 | 删 | 同上 |
| `Dockerfile` 中装 Node 24 | 删 | 上游用 node:26-alpine，自带 |
| `Dockerfile` 中装 tshark/iproute2 | 删 | v6 live-capture 不需要抓包工具链 |
| `entrypoint.sh` 中 `bun update -g @anthropic-ai/claude-code` | 保留 | v6 仍需 CC 二进制做模板提取 |
| `Dockerfile` 基础镜像 `oven/bun:1` | 改为上游的 `node:26-alpine` + 拷贝 bun 二进制 | 对齐上游，避免 Bun 镜像漂移 |

#### 4.2.3 保留的改造

- **凭证环境变量注入**：上游 v6 读 `~/.dario/` 文件，你的 dario 节点用环境变量。保留一层 adapter：entrypoint 从 `DARIO_OAUTH_*` 环境变量生成 `~/.dario/accounts/*.json`。Codex 同理生成 `~/.dario/codex-accounts/*.json`。
- **内部 API Key 认证**：`DARIO_API_KEY` 仍作为 dario 监听端口的内部认证（上游支持）。
- **健康端点**：`/healthz` `/metricsz` 保留（上游有 `/health` `/metrics`，命名对齐或保留你的别名）。

#### 4.2.4 上游 v6 自带能力（无需改造）

- `cc-drift-watch.yml` + `cc-drift-template-watch.yml`：自动跟 CC 版本、自动 capture、自动 release
- `codex-accounts.ts` / `codex-backend.ts` / `codex-oauth.ts`：Codex 订阅反代
- `provider-adapter.ts` + `provider-cooldown.ts`：Claude ↔ Codex 自动 failover + 分 provider 冷却
- `serving-probe.ts` / `doctor-serving.ts`：doctor 探测真实可用性，死号不再报 healthy
- `runtime-fingerprint.ts`：检测 Bun 运行时 TLS 指纹，非 bun-match 告警

### 4.3 codex-dario 退役

- 删除 `codex-dario/` 整个目录
- docker-compose 移除 `codex-dario-1` 服务
- CPA `codex-api-key` 的 `base-url` 从 `http://codex-dario-1:3457` 改为指向 dario v6 容器（dario v6 同时服务 Claude+Codex）

**Codex 凭证迁移**：

你的格式（env）→ 上游格式（`~/.dario/codex-accounts/<alias>.json`）：

```typescript
// 你的 env
CODEX_DARIO_OAUTH_ACCESS_TOKEN / REFRESH_TOKEN / EXPIRES_AT / CHATGPT_ACCOUNT_ID

// → 上游文件 ~/.dario/codex-accounts/<alias>.json
{
  "alias": "<account_id>",
  "accessToken": "<CODEX_DARIO_OAUTH_ACCESS_TOKEN>",
  "refreshToken": "<CODEX_DARIO_OAUTH_REFRESH_TOKEN>",
  "expiresAt": <CODEX_DARIO_OAUTH_EXPIRES_AT>,
  "idToken": undefined
}
```

迁移逻辑写进 dario entrypoint（从环境变量生成文件），或写一次性 `scripts/migrate-codex-creds.sh`。

### 4.4 docker-compose.yml 简化

**移除**：
- `codex-dario-1` 服务及其注释模板
- dario-1 中的 `DARIO_TLS_SHIM` `TLS_SHIM_*` 环境变量

**修改**：
- cpa 镜像 `eceasy/cli-proxy-api:latest` → `eceasy/cli-proxy-api:v7.2.149`
- dario-1 build context 仍 `./dario-modified`（fork clone）
- CPA `codex-api-key.base-url` 指向 dario-1

**新增**（可选，验证后启用）：
- dario-2 / dario-3 取消注释（扩量用）

### 4.5 tokensea-platform（不动）

本轮完全不动 tokensea-platform。它对接 CPA 的接口不变（CPA 仍是 `http://cpa:8080`），升级对它透明。

---

## 五、执行阶段

| 阶段 | 内容 | 风险 | 验证 |
|------|------|------|------|
| P1 | CPA 升级 + config 补全 | 低 | cpa 启动、`/v1/models` 可取、通过 cpa 发一个 Claude 请求成功 |
| P2 | fork dario v6.0.17，本地 rebase 外壳 | 中 | 本地 build 成功、`dario doctor` 全绿、单容器 Claude 请求成功 |
| P3 | Codex 凭证迁移 + dario v6 单容器同时跑 Claude+Codex | 中 | 两种请求都成功、限流时自动 failover |
| P4 | codex-dario 退役，docker-compose 简化 | 低 | compose up 全绿、无 codex-dario 残留 |
| P5 | 上 lisa 生产部署 | 中 | 健康检查、封号率观察 |

每个阶段独立可验证，失败可回滚。

---

## 六、风险与应对

| 风险 | 应对 |
|------|------|
| dario v6 rebase 后伪装精度不如 v3.32 | P2 本地验证 `dario doctor` runtime=bun-match + 模板版本 ≥ 2.1.259；不通过不上 lisa |
| Codex 凭证迁移后 OAuth 刷新失败 | P3 先用单个 Codex 凭证验证刷新链路；保留旧 codex-dario 镜像可回滚 |
| CPA v7.2 config 字段不兼容 | P1 改 config 后 cpa 启动日志确认无 warning；有问题对照 config.example.yaml |
| 上游 dario v6 行为变化（failover 逻辑）影响 CPA 路由 | P3 验证 CPA+dario 链路：Claude 限流 → dario 内部 failover 到 Codex → CPA 侧不重试 |
| CC 模板漂移 | v6 有自动 cc-drift-watch，升级后反而比 v3.32 更稳；P5 观察 1 周 |

---

## 七、非目标

- 不重构 tokensea-platform
- 不引入 Sub2API
- 不改 tokensea-website
- 不动监控栈（Prometheus/Grafana 配置不变，只调 scrape target 如有需要）
- 不做 K8s 迁移（仍 docker-compose）
