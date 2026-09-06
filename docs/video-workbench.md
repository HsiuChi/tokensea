# Video workbench

Entry: model marketplace → video workbench, `/app/video?model=seedance-2.5`. Text playground model selection redirects video models here.

First release supports seven reviewed Seedance/Kling/Hailuo models. `seedance-2.0-o` remains unavailable. Controls expose only reviewed parameter combinations. Reference images are public HTTPS URLs; local uploads, video/audio references, editing timelines, and cancelling accepted tasks are not supported.

Flow: select an owned API key → estimate without charging → explicitly confirm → submit with a persisted idempotency key. Ambiguous network failures retain the original request for manual same-ID recovery. The server returns existing submissions before route availability/rate checks, while still enforcing authentication, key ownership and model permission. A recovered request must have the same payload.

History is server-backed, owner-scoped, limited to the latest 100 video jobs, refreshed every 10 seconds. The existing server worker retrieves upstream status using the original channel node. The UI never receives upstream API credentials. Playback accepts only HTTPS result links. Download URLs can expire; users should save completed results promptly.

Validation: 56 unit tests; PostgreSQL reservation and video integration tests including owner-scoped history; backend/frontend type checks; production build; mocked browser flow for estimate/no-charge, lost response, refresh, same-ID recovery, playback, and light/dark/mobile layouts. No paid live generation was submitted for these UI tests.
