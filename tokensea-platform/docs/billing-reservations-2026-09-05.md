# Durable billing reservations

## Implemented

- Release safety fix: accounting exceptions have their own error type and cannot enter upstream failover or zero-usage fallback. Invalid usage immediately enters review; result-save failures retain the original hold/pending result even during database outages. A successful upstream response that cannot be parsed also retains funds. Transport failures without an explicit upstream rejection are not retried automatically.

- PostgreSQL wallet/group/key row locks; each request reserves funds before upstream dispatch. No Redis TTL can release money.
- Settlement uses the price and multipliers captured at admission, persists the result before the final transaction, and updates reservation, request log, ledger and user/key/group counters atomically.
- Request ID is the reservation primary key. Only `pending` can finalize; worker retries persisted results every 30 seconds without rerunning inference.
- Known zero-usage failures release holds. Partial streams with usage are charged for the recorded usage. Missing/invalid usage, ambiguous transport failure or a crash before usage persistence requires review. A 20-minute age only marks review, never refunds automatically.
- Review blocks further calls from that wallet. Admin can retry saved settlement, or explicitly waive/release with an audited explanation. No automatic write-off or negative balance.
- Key deletion revokes and hides the key, retaining financial history. Reservation foreign keys restrict physical deletion.
- Read-only reconciliation compares opening balances + post-upgrade finalized charges against user/key/group counters and cross-checks ledger/log amounts. Historical openings are not proof of old ledger completeness.
- User `/api/billing/self`; admin `/api/billing/reconcile/:userId`, `/pending`, `/review/:requestId`. UI is in usage records and admin channels.

## Admission behavior and release decision

- Without a caller output cap, text generation is capped at 4096 output tokens. Explicit caps are preserved. Text uses actual prompt UTF-8 bytes plus small message overhead, not a fixed 8192-token surcharge. Remote images/base64 do not count as text; references use a documented 4096-token-per-image estimate. Unresolved audio/files still retain a conservative context allowance. These are estimates, not exact tokenization.
- GPT Image 2 reserves by quality, size and count using the official Image 2 output-only estimates, with a 25% margin and rounding allowance. It no longer reserves 65536 output tokens or full input context for every image. Auto quality uses high; auto size uses the highest common-size estimate. Custom sizes are a labeled pixel-scaled estimate, not official fixed prices. Multipart edits pass actual size/quality/file count into the estimator.
- Unknown real cost above available funds is held for review, not charged beyond the balance. Estimates are not guarantees that an upstream will obey its budget.
- Async video: KSP Kling V3/Omni use reviewed per-second audio/mode tiers; Hailuo uses resolution/duration tiers; Seedance 2.0 domestic/2.5 text/image-reference requests reserve an estimated token budget and settle from positive final usage. Frozen snapshots include CNY rate, configured CNY/USD conversion and plan/channel multipliers. No changes to existing text tariffs or multipliers.
- Unknown price combinations are rejected individually before dispatch: Seedance 2.0-o, reference video/audio, custom voices/motion-control and unreviewed extra parameters. A known task failure releases its hold; missing usage, uncertain submission, mismatched task identity/result count/duration or >24h unresolved jobs require review. Polling HTTP failures do not refund.
- Video task metadata lives in the reservation payload. Creation is claimed once using an atomic payload transition; a reused Idempotency-Key is scoped to the user's API Key and checks the canonical request fingerprint. All polls use the original node. The worker resumes pending jobs after restart; API GET returns owner-scoped cached state and does not forward arbitrary upstream task/file IDs. Legacy provider-shaped poll URLs must change to the returned TokenSea pollUrl. A process crash before task ID persistence is deliberately not retried automatically.
- Model details include a no-charge estimate tool backed by authenticated POST /api/billing/estimate. Quotes are informational; admission recalculates prices and checks funds. Request detail separates reserved amount from final charge, with video-specific billing explanation.
- Payment/chargeback/refund-order workflows are not part of this patch. Reviewed zero-charge release is a waived inference charge, not a payment refund.

## Verification

`DATABASE_URL=postgresql://.../billing_test_clean node --import tsx test/reservation.integration.mjs`

Only isolated databases named billing_test are allowed by this test. It creates its own fixtures and cleans only those. Tests include 16-way shared-wallet contention, repeated concurrent settlement, group and daily limits, zero-cost release, pending-result recovery, frozen pricing, missing usage, stale holds, explicit review resolution, key revocation/history and reconciliation drift.

The migration history previously omitted db-push changes. An additive compatibility migration records those before creating billing tables. Both complete fresh migration and integration tests are verified; production migration has not run.

## Deployment checklist

1. Review model-specific unsupported variants and the managed TokenSea polling contract; validate each provider's real task lifecycle with a small controlled call before production enablement. Local mocked tests are not proof of upstream compatibility.
2. Back up database, source, environment and old image. Build the new image while old app serves traffic.
3. Stop/drain the old app before baseline migration; old writers must not race with opening balance capture.
4. Apply `prisma migrate deploy` with new image, then start new app. Do not run old/new writers together.
5. Verify small real chat/image calls, replay safety and `/api/billing/self` after recreation; no existing account reset.
6. If rollback is needed after traffic, stop writers and inspect holds first. Old code ignores holds and must not be restarted blindly.

## Pricing evidence and limits (2026-09-05)

- OpenAI Image 2 output estimates: https://developers.openai.com/api/docs/guides/image-generation . Use Image 2's calculator/table, not the preceding-generation token table. At 1024 square, output-only low/medium/high estimates are USD 0.006/0.053/0.211; input is additional. TokenSea still bills actual returned modality usage.
- Actual upstream video CNY tiers: https://docs.ksyun.com/documents/44741 (price version 2026-08-26). No subscription-member or third-party prices substituted.
- Seedance task schema (including singular usage.total_token): https://docs.ksyun.com/documents/45628 . Zero placeholder usage is not treated as a free successful task.
- Seedance estimation formula reference: https://docs.byteplus.com/docs/ModelArk/1099320 . The formula is used only as an approximate hold; BytePlus rates are NOT used as KSP rates.
- Kling task contract: https://docs.ksyun.com/documents/44983 . Hailuo lifecycle reference: https://platform.minimaxi.com/docs/api-reference/video-generation-query . KSP compatibility still requires a real provider smoke test.

New tests: test/reservation-estimate.test.mjs (parameter-aware estimates/rate tiers), test/video-reservation.integration.mjs (durable task dispatch, ownership, original-node pinning, crash recovery, failure/missing usage handling and single settlement). Run against an isolated billing_test database only. No production migration/deployment or live video generation was performed during this adjustment.

Adjustment verification: 28 unit tests passed; both real PostgreSQL integration suites passed; seven migrations applied successfully to an empty isolated database; backend TypeScript and Vite production build passed. Follow-up verification fixes the translation count type in web/src/pages/admin/Redemptions.tsx:171; full frontend TypeScript now also passes. The Vite build retains its existing large-bundle warning.

Follow-up live upstream verification is recorded in video-smoke-2026-09-05.md. Kling V3, Hailuo-02 and Seedance 2.0 domestic successfully generated accessible MP4 files. Hailuo 512P requires a first-frame image even though the price table lists a 512P tier; this is now validated before reservation. A definitive Hailuo HTTP 200 / business code 2013 rejection without a task ID releases the hold, while ambiguous errors still require review. Kling's observed 3.041s output for a 3s request is handled with a 50ms tail-frame tolerance; larger duration mismatches still require review. Real Seedance completion_tokens usage is covered in the isolated settlement test.
