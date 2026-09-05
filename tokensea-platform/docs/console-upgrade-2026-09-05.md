# Console and CPA upgrade

## Scope

- User statistics use one bounded UTC request-log range, including failures. P95 is nearest-rank over successful requests with recorded durations; no samples returns null. End dates are exclusive; date-only end includes that day.
- Keys support a total USD cap (-1 unlimited, 0 blocked), model IDs, expiry, IPv4/IPv6/CIDR. Key and group model limits intersect. IP policy is enforced by all relay entry points.
- Caller-supplied probe headers cannot bypass billing. Public key updates cannot assign arbitrary billing plans.
- Request details are owner scoped, expose saved pricing snapshots, not reconstructed current prices. Export defaults to 30 days, max 10000 rows with an explicit truncation warning and CSV formula escaping.
- Native image generation honors the selected route/model, including GPT Image 2. Text/image inputs are billed separately. Streaming usage buffers partial SSE lines; OpenAI cached input is not charged twice.
- CPA management is server-only and fixed to the configured internal origin. Credentials are never returned. Account quota data is cached for 5 minutes, missing data stays unknown. No quota-reset or account deletion calls.
- Low remaining quota (10%) creates an alert, deduplicated for one hour. Node authentication/429/quota errors are deduplicated for five minutes. Events and webhook outcomes are stored in audit logs. Webhook retries run in process (3 attempts); this is not a durable outbox and in-flight delivery may be lost on restart.

## Reference prices

Verified 2026-09-05, standard API reference rates, USD / million Tokens:

- GPT-6 Astra: input 10, cache read 1, cache write 12.5, output 50. Over 272000 input Tokens: whole-request input/cache ×2 and output ×1.5.
- GPT Image 2: text input 5, cached text 1.25; image input 8, cached image 2; output 30.

Sources: https://developers.openai.com/api/docs/models/gpt-6-astra and https://developers.openai.com/api/docs/pricing

Only the two explicitly approved models are enabled by scripts/enable-reviewed-models.ts --apply. Other model statuses and prices are preserved. Existing plan/channel multipliers still apply. These are retail reference prices, not CPA subscription supplier costs.

## Deployment

1. Backup database, app sources, infra config and current image.
2. Build and test source; deploy image and force-recreate app.
3. Reuse the existing CPA management secret through scripts/configure-operations.mjs; only enable management access inside Docker's private network, no public port publication.
4. Configure TRUSTED_PROXY_CIDRS for the Caddy Docker network, never blindly trust all forwarding headers on a publicly exposed app port.
5. Run scripts/enable-reviewed-models.ts in dry-run then --apply; model state backup is written to /tmp (bind mount a persistent backup directory).
6. Verify public health, admin authorization rejection, account overview, exact model list, real TokenSea-key request and ledger.

## Known boundaries

- KSP quota is not available through this adapter; key count is not an account balance.
- Historical requests without pricing/error metadata cannot be retroactively reconstructed.
- Request duration is end-to-end latency, not TTFT; success rate counts persisted requests, not rejected pre-auth traffic.
- Quota caps are checked before requests; concurrent/in-flight requests can exceed the remaining cap. Strict prepaid reservations are not implemented here.
- API HTTP streaming/Batch/Flex/priority surcharges outside configured standard pricing are not advertised as supported.
