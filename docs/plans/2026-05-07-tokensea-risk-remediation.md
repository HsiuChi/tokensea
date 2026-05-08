# TokenSea Risk Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce account-ban, abuse, security, and operations risks before exposing TokenSea as an API service to users.

**Architecture:** Keep `cpa` as the public API gateway and `dario-*` as private upstream workers, but add hard security boundaries around public ingress, user identity, rate limits, monitoring, and deploy reproducibility. This plan does not describe evasion of Claude or Anthropic detection; it focuses on reducing unauthorized use, abnormal traffic, account concentration, and operational drift.

**Tech Stack:** Docker Compose, CPA (`eceasy/cli-proxy-api`), modified Dario, Redis, Prometheus, Grafana, shell scripts.

## Current Findings

### Critical Findings

- Public API currently accepts the default sample key `tsk-prod-key-001-change-me`; public smoke test to `http://192.204.62.165:8080/v1/models` returned `200` with that key.
- `cpa`, Grafana, and Prometheus are exposed on public interfaces via `0.0.0.0:8080`, `0.0.0.0:3000`, and `0.0.0.0:9090`.
- Host firewall is inactive and `INPUT` policy is `ACCEPT`, so Docker-published ports are reachable from the internet.
- CPA logs already show internet scanners requesting paths such as `/.env`, `/login`, and `/geoserver/web/`.
- The service goal is to turn Claude Team/Pro/Max subscriptions into an API for users. That is a high account-risk and terms-risk pattern compared with official Claude API billing.

### Important Findings

- CPA management is enabled remotely with sample secret `ts-mgmt-key-change-me`.
- Grafana is configured with `GF_SECURITY_ADMIN_PASSWORD=admin` and `GF_AUTH_ANONYMOUS_ENABLED=true`.
- Prometheus scrapes disabled `dario-2` and `dario-3` targets, producing permanent down targets.
- Prometheus scrapes CPA at `/metrics`, but CPA currently returns `404`, generating noisy logs every 15 seconds.
- Runtime updates Claude Code at container startup, so behavior can change after restart without a code or image change.
- Several images use floating `latest` tags, reducing rollback confidence.
- Only `dario-1` is enabled, so all user traffic concentrates on one subscription identity.

## Remediation Principles

- Do not publish internal monitoring or worker endpoints directly to the internet.
- Treat every user as a separate tenant with a separate API key, quota, rate limit, and audit trail.
- Prefer official Claude API billing for external user-facing API products.
- If subscription-backed routing remains in use, keep it private, limited, and observable.
- Pin all deploy-time behavior that can affect request shape, dependency behavior, or rollback.

## Phase 1: Stop Immediate Exposure

### Task 1: Replace Public Sample Credentials

**Files:**
- Modify: `config/config.yaml`
- Check: `.env`

**Steps:**

1. Replace all values matching `*-change-me` in `config/config.yaml`.
2. Generate strong random API keys for `api-keys`.
3. Generate a strong random `remote-management.secret-key`.
4. Ensure Dario internal keys in `.env` match `claude-api-key` upstream entries.
5. Restart CPA with `docker compose up -d cpa`.
6. Verify unauthenticated access returns `401`.
7. Verify old sample key returns `401`.
8. Verify new key returns `200` for `/v1/models`.

**Verification Commands:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/v1/models
curl -s -o /dev/null -w "%{http_code}\n" -H "x-api-key: tsk-prod-key-001-change-me" http://localhost:8080/v1/models
curl -s -o /dev/null -w "%{http_code}\n" -H "x-api-key: <new-key>" http://localhost:8080/v1/models
```

**Expected Result:**

- No key: `401`
- Old sample key: `401`
- New key: `200`

### Task 2: Remove Public Access to Monitoring

**Files:**
- Modify: `docker-compose.yml`

**Steps:**

1. Change Prometheus port mapping from `9090:9090` to `127.0.0.1:9090:9090`, or remove the mapping entirely.
2. Change Grafana port mapping from `3000:3000` to `127.0.0.1:3000:3000`, or put it behind authenticated reverse proxy.
3. Set `GF_AUTH_ANONYMOUS_ENABLED=false`.
4. Replace `GF_SECURITY_ADMIN_PASSWORD=admin` with a secret sourced from `.env`.
5. Recreate Grafana and Prometheus.
6. Verify public access to `3000` and `9090` is blocked.
7. Verify local SSH access still works.

**Verification Commands:**

```bash
docker compose up -d prometheus grafana
ss -ltnp | grep -E ':(3000|9090)'
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:9090/-/healthy
```

**Expected Result:**

- Host listeners bind to `127.0.0.1`, not `0.0.0.0`.
- Local health checks return `200`.
- Public checks from outside the server fail or time out.

### Task 3: Add Host Firewall Rules

**Files:**
- Document: `README.md`
- Optional script: `scripts/firewall.sh`

**Steps:**

1. Allow SSH on the configured port.
2. Allow only required public ingress for the API or reverse proxy.
3. Deny direct public access to `3000`, `9090`, and any Dario worker port.
4. Enable the firewall.
5. Document recovery commands before enabling.

**Verification Commands:**

```bash
ufw status verbose
ss -ltnp
```

**Expected Result:**

- SSH remains reachable.
- Only intended public API ingress is reachable.
- Monitoring ports are not reachable from the internet.

## Phase 2: Add User-Level Control

### Task 4: Introduce User-Level API Keys

**Files:**
- Modify: `config/config.yaml`
- Create: `docs/operations/user-key-management.md`

**Steps:**

1. Define a key format that maps each key to one user.
2. Store user metadata outside code and outside git.
3. Add a process for creating, rotating, disabling, and auditing keys.
4. Document how to identify which user made a request.
5. Verify disabled keys stop working immediately after reload.

**Expected Result:**

- No shared public key is used by multiple users.
- Compromised or abusive users can be disabled without affecting everyone.

### Task 5: Add Rate Limits and Quotas

**Files:**
- Modify: `config/config.yaml`
- Modify or add gateway/reverse-proxy configuration if CPA does not support required policy.

**Steps:**

1. Add per-key request rate limits.
2. Add per-key concurrent request limits.
3. Add daily or rolling-window usage quotas.
4. Add separate limits for streaming and long-running requests.
5. Return clear `429` responses when limits are exceeded.
6. Log key ID, status code, latency, and upstream result.

**Expected Result:**

- One user cannot exhaust the full pool.
- Abnormal traffic can be contained before it reaches subscription identities.

### Task 6: Add Abuse Controls

**Files:**
- Modify: gateway or reverse-proxy configuration
- Create: `docs/operations/abuse-response.md`

**Steps:**

1. Define block conditions for high error rate, excessive concurrency, repeated 429s, or unusual request volume.
2. Add temporary suspension for abusive keys.
3. Add manual override for emergency disable.
4. Add alerts for spikes in requests, 401s, 429s, and upstream failures.

**Expected Result:**

- Abusive traffic is stopped at the gateway, not at Claude upstream.

## Phase 3: Reduce Subscription Account Risk

### Task 7: Isolate Subscription Identities

**Files:**
- Modify: `docker-compose.yml`
- Modify: `config/config.yaml`
- Check: `.env`

**Steps:**

1. Add only real, configured `dario-*` workers.
2. Ensure each worker has its own OAuth token and device/account identity.
3. Avoid routing unrelated users into the same worker without limits.
4. Add worker-level health checks and cooldown state.
5. Do not expose worker ports publicly.

**Expected Result:**

- A single worker failure or account issue does not affect the whole service.
- Worker traffic is easier to attribute and isolate.

### Task 8: Add Upstream Circuit Breakers

**Files:**
- Modify: CPA configuration or gateway layer
- Modify: Dario pool/routing code if needed

**Steps:**

1. Detect upstream `429`, `401`, `403`, and repeated `5xx`.
2. Put unhealthy upstreams into cooldown.
3. Avoid retry storms across all accounts.
4. Emit metrics for cooldown events.
5. Alert when any subscription identity sees repeated authorization or rate-limit errors.

**Expected Result:**

- One degraded account is not repeatedly hammered.
- Upstream risk signals become visible before full outage or account lock.

## Phase 4: Clean Monitoring and Alerting

### Task 9: Fix Prometheus Targets

**Files:**
- Modify: `monitoring/prometheus.yml`

**Steps:**

1. Remove `dario-2` and `dario-3` until those services are enabled.
2. Remove CPA `/metrics` scrape if CPA does not expose Prometheus metrics.
3. Keep `dario-1:3456/metricsz` and Prometheus self-monitoring.
4. Reload Prometheus.
5. Verify all active targets are healthy.

**Verification Commands:**

```bash
curl -s http://localhost:9090/api/v1/targets
docker compose logs --tail=100 prometheus
docker compose logs --tail=100 cpa
```

**Expected Result:**

- No permanent down targets.
- CPA logs no longer show `/metrics` 404 every 15 seconds.

### Task 10: Add Actionable Alerts

**Files:**
- Create: `monitoring/alert_rules.yml`
- Modify: `monitoring/prometheus.yml`
- Modify: `docker-compose.yml`

**Steps:**

1. Alert on Dario worker down.
2. Alert on high upstream error rate.
3. Alert on high `429` rate.
4. Alert on high request concurrency.
5. Alert on token expiry or invalid OAuth status if exported.
6. Route alerts to an operator-controlled channel.

**Expected Result:**

- Operators see early warning before users report failures or upstream accounts are stressed.

## Phase 5: Make Deploys Reproducible

### Task 11: Pin Runtime Versions

**Files:**
- Modify: `docker-compose.yml`
- Modify: `dario-modified/Dockerfile`
- Modify: `dario-modified/entrypoint.sh`

**Steps:**

1. Replace floating `latest` image tags with pinned versions.
2. Decide whether Claude Code should auto-update on every startup.
3. For production, set `DARIO_NO_CC_UPDATE=1` by default.
4. Update Claude Code only during controlled deploys.
5. Document rollback steps.

**Expected Result:**

- Restarting the same deployment does not silently change request behavior.
- Rollback is possible when a dependency update causes regressions.

### Task 12: Add Deployment Verification

**Files:**
- Create or modify: `scripts/health-check.sh`
- Create: `docs/operations/deploy-checklist.md`

**Steps:**

1. Check container health.
2. Check unauthenticated API returns `401`.
3. Check sample old key returns `401`.
4. Check active key returns `200`.
5. Check monitoring targets are healthy.
6. Check public monitoring ports are closed.
7. Check recent logs for `error`, `warn`, `fail`, `401`, `403`, `429`, and `5xx`.

**Expected Result:**

- Every deploy has a repeatable pass/fail checklist.

## Phase 6: Product and Compliance Decision

### Task 13: Decide Supported Usage Model

**Files:**
- Create: `docs/product/usage-model.md`

**Steps:**

1. Choose whether TokenSea is internal-only or external user-facing.
2. If external user-facing, evaluate migration to official Claude API billing.
3. Document data retention behavior for prompts, responses, logs, and metrics.
4. Document user responsibilities and prohibited usage.
5. Define incident response for compromised keys or upstream account warnings.

**Expected Result:**

- The service has a clear operating model before more users are added.

## Recommended Execution Order

1. Task 1: Replace public sample credentials.
2. Task 2: Remove public access to monitoring.
3. Task 3: Add host firewall rules.
4. Task 9: Fix Prometheus targets.
5. Task 12: Add deployment verification.
6. Task 4: Introduce user-level API keys.
7. Task 5: Add rate limits and quotas.
8. Task 6: Add abuse controls.
9. Task 7: Isolate subscription identities.
10. Task 8: Add upstream circuit breakers.
11. Task 11: Pin runtime versions.
12. Task 10: Add actionable alerts.
13. Task 13: Decide supported usage model.

## Non-Goals

- Do not add logic whose purpose is to bypass Claude or Anthropic detection.
- Do not optimize fingerprints for evasion.
- Do not hide abusive or unauthorized traffic.
- Do not treat subscription-backed routing as equivalent to official Claude API billing.

## First Emergency Patch Checklist

Use this checklist before adding more users:

- [ ] Replace `tsk-prod-key-001-change-me`.
- [ ] Replace `tsk-prod-key-002-change-me`.
- [ ] Replace `ts-mgmt-key-change-me`.
- [ ] Disable or restrict CPA remote management.
- [ ] Restrict Grafana to localhost or authenticated reverse proxy.
- [ ] Restrict Prometheus to localhost or private network.
- [ ] Enable firewall rules.
- [ ] Remove disabled Dario scrape targets.
- [ ] Remove CPA `/metrics` scrape if unsupported.
- [ ] Verify old sample key fails from public internet.
- [ ] Verify only intended API endpoint is public.
