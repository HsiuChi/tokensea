# Platform safety and operations

## Scope
Payments remain disabled by default (`PAYMENTS_ENABLED=false`). Alipay and WeChat remain unavailable, per owner request: no merchant accounts yet. No real charge/refund or merchant verification has been performed. Do not enable payment based only on these local tests.

Subscription purchase/renewal is fail-closed for every payment method, including balance. Existing wallet totals are not converted, confiscated, or re-granted. Expired bindings are marked expired without automatically disabling unrelated keys. Subscription sales require a separate entitlement accounting design before reopening; strategy administration now edits actual schema fields, not obsolete price/quota forms.

## Wallet and orders
- Ledger units remain micro-USD; CNY display uses the fixed shared 7.2 rate.
- Stripe order creation accepts a CNY budget, rounds the payable USD cents, and credits exactly those cents in micro-USD. FX, currency, minor amount and unit version are persisted per order.
- Legacy orders default to `legacy`; automatic fulfillment refuses them. No historical monetary data is rewritten by migration.
- Payment creation is disabled before DB insertion when the method is unavailable. User/order idempotency and gateway idempotency preserve retries.
- Raw webhook bytes are verified. Fulfillment requires paid status, matching order/session/version/currency/amount. Wallet row locking and unique entry reference prevent duplicate credits.
- New quota changes from topups, redemptions and admin adjustments have wallet entries. API usage remains in the existing usage ledger. Existing balances are opening balances, not reconstructed history.
- Negative adjustments may not consume held or already-used funds. Redeeming a shared code is serialized and a user can redeem it only once.
- Paid-session polling recovers missed callbacks for known gateway sessions. Unknown session creation results remain pending and require retry with the original idempotency key, not fabricated success. Legacy/ambiguous orders require operator review.
- Refund automation is not enabled. Manual balance adjustments are NOT gateway refunds. Merchant onboarding, live/sandbox reconciliation and refund/dispute lifecycle acceptance remain required before real payment rollout.

## Admission and alerts
- Atomic Redis admission checks user QPS/RPM, text token budget and concurrent requests. Default concurrency is 4; configurable by USER_MAX_CONCURRENT (1–100).
- TPM reserves UTF-8 input bytes plus requested maximum output for a 60-second window. It is a conservative admission budget, not billed tokens. Omitted output limits default to 4096. Image/video requests use request/concurrency limits, not text TPM.
- Leases release on response finish. Disconnected clients retain a bounded 15-minute lease, avoiding immediate bypass while upstream may still run.
- Model policies are enforced in text, image and video request handlers.
- CPA account quota checks run every 5 minutes independent of dashboard visits; KSP still lacks an authoritative account balance connector. Multiple KSP keys are not claimed as independent balances.
- Webhook jobs persist in PostgreSQL, retain a stable delivery ID, retry transient errors with backoff up to 5 attempts, and allow audited manual retry from admin settings. Receivers must deduplicate delivery IDs (at-least-once delivery).

## Verification
64 unit tests, isolated PostgreSQL/Redis integration, 12-way payment fulfillment, 6-way checkout creation, 8-way redemption, wallet reconciliation, raw signature/tampering, concurrency/TPM rejection, persistent notification retry. Existing 16-way reservation/settlement and asynchronous video recovery integrations pass. Browser checks cover payment-disabled UI, balances/holds, debit display, light/dark/mobile, strategy admin. No production financial mutation used for testing.

Official payment reference: https://docs.stripe.com/webhooks and https://docs.stripe.com/api/checkout/sessions/object

## Deployment
Apply additive migration `20260907030000_wallet_orders` before starting the new application. Snapshot database, source, image, wallet/key/ledger totals and tariffs before rollout. Old image can run against the additive schema, but reopens the old subscription vulnerability: prefer forward-fix or block subscription/topup POST routes if rolling back. Do not drop the new tables during an emergency rollback.
