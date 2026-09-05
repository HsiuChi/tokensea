# Live video compatibility verification — 2026-09-05

Production application and database schema were not changed. Calls were issued directly to the configured KSP upstream from the running application container, using existing node 27. Credentials remained on the server and were not printed. These are upstream compatibility tests, not a claim that the new TokenSea settlement code is deployed.

| Model | Parameters | Upstream task ID | Current result |
| --- | --- | --- | --- |
| kling-v3 | 3s, std, sound off | tsk-giepuh180j2aqs24 | succeed; one video, reported duration 3.041s; MP4 HEAD 200 |
| hailuo-02 | 6s, 512P, text only | none | HTTP 200 / business code 2013: 512P requires first_frame_image |
| hailuo-02 | 6s, 768P, text only | 438407404196227 | Success; file retrieval 200; MP4 GET Range 206 |
| seedance-2.0-domestic | 4s, 480p, 16:9, audio off | cgt-20260905132532-pfcvf | succeeded; completion_tokens = total_tokens = 40594; MP4 GET Range 206 |

The definitive Hailuo rejection led to two fixes: reject unsupported 512P text-only requests before reservation; release holds on HTTP 200 / business code 2013 with no task ID. Unit/integration regression tests cover both. No uncertain submission was retried.

Quoted upstream costs for the accepted requests: Kling CNY 1.80, Hailuo CNY 2.00, Seedance depends on final reported video tokens. The invalid Hailuo request did not return a task; actual upstream invoices have not been reconciled.

Final Seedance public-rate calculation: 40,594 × CNY 46 / 1,000,000 = CNY 1.867324. Total test cost at the published tariffs is approximately CNY 5.67, not an independently reconciled invoice.

Kling's extra 0.041s is an encoded tail frame. The adapter now tolerates at most 50ms of container duration rounding while retaining the requested quoted tier; larger mismatches still require review. Regression tests cover both a tail frame and a one-second mismatch.

Seedance/Hailuo signed URLs reject HEAD (403), but authorized GET Range bytes=0-31 returns 206 video/mp4 and an ftyp signature; only 32 bytes were read per video, with no full media file saved. Hailuo file metadata contract matched file.download_url and file_id as implemented.

Verification after fixes: 28 unit tests, both isolated PostgreSQL integration suites, backend TypeScript, full frontend TypeScript and frontend production build pass. Live Seedance completion_tokens shape and 40,594-token quantity were replayed through the isolated settlement integration: charged USD 0.259351 at CNY/USD 7.2 and multiplier 1, with excess reservation released. Tests also cover Hailuo HTTP-200 business failure, bound file retrieval, and Kling tail-frame rounding.

Scope: three representative model variants verified end-to-end at the upstream, not every video model/parameter combination. The new TokenSea billing implementation has only been tested locally and has not been pushed or deployed in this verification. No customer balance or production schema was modified. Temporary local verification database/container was removed afterward.
