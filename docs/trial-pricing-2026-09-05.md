# Trial pricing: cost plus 50%

Version: `trial-cost-plus-2026-09-05`. Sales = estimated cost × 1.5 (33.33% gross margin before other operating expenses), not 50% gross margin.

- GPT subscription planning assumption: $100 monthly cost buys $500 of API-equivalent usage. This is not a guaranteed subscription quota or measured capacity. Estimated cost ratio 20%; retail 30% of captured official API reference prices.
- KSP text/video: captured public tariff is the estimated cost, retail × 1.5. No unverified wholesale discount is assumed.
- GLM 5.3 Flash has an unverified zero-cost catalog entry. Trial operating-cost floor per million tokens: CNY 1 input / 4 output / 0.1 cached; retail 1.5 / 6 / 0.15.
- Fixed display conversion: USD 1 = CNY 7.2, not live FX. Ledger remains micro-USD. Payment currency and existing balances are not migrated.
- Internal cost assumptions are not returned in public model pricing or user billing exports.
- Active models only. Removed models are not reactivated. Unreviewed video variants remain fail-closed.

## Release procedure

Run `node --import tsx scripts/apply-trial-pricing.ts` for a read-only preview. Apply only after draining the app and backing up the database. Set `PRICING_BACKUP_DIR` to a private mounted directory and add `--apply`. The script saves previous prices/multipliers, performs a serializable transaction, and records an audit entry. It refuses to reset a channel shared with an active model outside the update set. Repeat application is a no-op.

Explicit retail prices replace the former extra channel multiplier; covered channel multipliers become 1. Catalog reimport preserves versioned retail prices. Existing reservations retain their saved tariff and channel multipliers; video quotes without the new multiplier retain legacy behavior.

Rollback before reopening traffic: restore the drained database backup and previous image/config. After reopening, do not restore a whole old database over new financial transactions; restore only versioned pricing fields and roll forward application fixes.

Verified locally: 53 unit tests; reservation, video reservation and trial-price migration integration tests; backend/frontend TypeScript; production frontend build. Existing large-bundle warning remains.
