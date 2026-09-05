import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeCpa, upstreamHeaders } from '../src/services/channel/upstream-request.ts';

test('CPA uses bearer authentication and rejects invalid health responses without fallback', async () => {
  const original = globalThis.fetch;
  const node = { adapter: 'cpa', authType: 'x-api-key', internalApiKey: 'test-only', internalUrl: 'http://cpa:8080' };
  assert.deepEqual(upstreamHeaders(node), { authorization: 'Bearer test-only' });
  try {
    for (const [status, body, expected] of [[200, {data:[{id:'test-model'}]}, true], [401, {data:[{id:'test-model'}]}, false], [503, {data:[]}, false], [200, {}, false], [200,{data:[]},false], [200,{data:[{}]},false]]) {
      let calls = 0;
      globalThis.fetch = async (url, opts) => {
        calls++;
        assert.equal(url, 'http://cpa:8080/v1/models');
        assert.equal(opts.headers.authorization, 'Bearer test-only');
        return new Response(JSON.stringify(body), {status});
      };
      assert.equal((await probeCpa(node)).healthy, expected);
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = original; }
});
