"""
mitmproxy addon to capture H2 traffic between CC and api.anthropic.com.

Usage:
  mitmdump -s capture/mitm-h2-capture.py -q

Then:
  NODE_TLS_REJECT_UNAUTHORIZED=0 HTTPS_PROXY=http://127.0.0.1:8080 \
    claude -p "hi" --max-turns 1

Output:
  capture/mitm-cc.jsonl
"""

import json
from datetime import datetime, timezone
from mitmproxy import http, ctx


class H2Capture:
    def __init__(self):
        self.out = None
        self.req_id = 0
        self.resp_id = 0

    def load(self, loader):
        self.out = open("capture/mitm-cc.jsonl", "w")
        self._log("addon.loaded", {})

    def _log(self, event, data):
        entry = {"ts": datetime.now(timezone.utc).isoformat(), "event": event, **data}
        self.out.write(json.dumps(entry, default=str) + "\n")
        self.out.flush()

    def requestheaders(self, flow: http.HTTPFlow):
        self.req_id += 1
        headers = [[k, v] for k, v in flow.request.headers.items()]
        self._log("request.headers", {
            "id": self.req_id,
            "method": flow.request.method,
            "url": flow.request.pretty_url,
            "http_version": flow.request.http_version,
            "headers": headers,
        })

    def request(self, flow: http.HTTPFlow):
        body_size = len(flow.request.content) if flow.request.content else 0
        self._log("request.complete", {
            "id": self.req_id,
            "body_size": body_size,
        })

    def responseheaders(self, flow: http.HTTPFlow):
        self.resp_id += 1
        headers = [[k, v] for k, v in flow.response.headers.items()]
        self._log("response.headers", {
            "id": self.resp_id,
            "status_code": flow.response.status_code,
            "http_version": flow.response.http_version,
            "headers": headers,
        })

    def response(self, flow: http.HTTPFlow):
        body_size = len(flow.response.content) if flow.response.content else 0
        self._log("response.complete", {
            "id": self.resp_id,
            "status_code": flow.response.status_code,
            "body_size": body_size,
        })

    def done(self):
        if self.out:
            self._log("addon.done", {"requests": self.req_id, "responses": self.resp_id})
            self.out.close()


addons = [H2Capture()]
