import test from 'node:test';
import assert from 'node:assert/strict';
import { trialPrice, publicPricing, publicBillingDetail, preserveRetailPrice, MARKUP } from '../src/services/billing/trial-pricing.ts';
import { calculateTokenPrice } from '../src/services/billing/token-pricing.ts';
import { quoteVideo, videoSettlement } from '../src/services/billing/video-pricing.ts';
import { formatMoney } from '../src/shared/money.ts';

test('trial pricing uses cost plus 50%, not 50% gross margin', () => {
  const m = { alias: 'gpt-5.6-sol', category: 'chat' };
  const p = trialPrice(m);
  assert.equal(MARKUP, 1.5);
  assert.equal(p.inputPrice, 1.2);
  assert.equal(p.outputPrice, 6);
  assert.equal(p.pricing.internalCost.measured, false);
  assert.deepEqual(trialPrice({ ...m, ...p }), p);
  const bill = calculateTokenPrice(p, { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheCreationTokens: 0 });
  assert.equal(bill.billableUnits, 7200n);
  assert.equal(bill.detail.internalCost.costUsd, .0048);
  assert.equal(bill.detail.internalCost.profitUsd, .0024);
});

test('KSP cost reference does not compound markup on repeat application', () => {
  const model = { alias: 'kimi-k3', category: 'chat', pricing: { upstreamCny: { input: 20, output: 100, cacheRead: 2 } } };
  const price = trialPrice(model);
  assert(Math.abs(price.inputPrice * 7.2 - 30) < 1e-7);
  assert(Math.abs(price.outputPrice * 7.2 - 150) < 1e-7);
  assert.deepEqual(trialPrice({ ...model, ...price }), price);
  assert.equal(trialPrice({ alias: 'unknown' }), null);
});

test('estimated procurement details are excluded from public pricing and user billing', () => {
  const p = trialPrice({ alias: 'gpt-6-astra', category: 'chat' });
  assert.equal(publicPricing(p.pricing).internalCost, undefined);
  assert.equal(publicPricing({ upstreamCny: {}, source: 'private', sourceUrl: 'private' }).source, undefined);
  assert.deepEqual(publicBillingDetail({ costUsd: 3, internalCost: { costUsd: 2 } }), { costUsd: 3 });
});

test('video cost plus 50% is applied exactly once and frozen in the quote', () => {
  const oldQuote = quoteVideo('kling-v3', { duration: 5, mode: 'std', sound: 'on' }, 7.2);
  const quote = quoteVideo('kling-v3', { duration: 5, mode: 'std', sound: 'on' }, 7.2, 1, 1, 1.5);
  assert.equal(quote.amount, oldQuote.amount * 3n / 2n);
  assert.equal(videoSettlement(quote.detail).billableUnits, quote.amount);
  const legacy = { ...oldQuote.detail };
  delete legacy.saleMultiplier;
  assert.equal(videoSettlement(legacy).billableUnits, oldQuote.amount);
});

test('dual display converts dollars rather than relabelling balances', () => {
  assert.equal(formatMoney(10), '¥72 / $10');
  assert.equal(formatMoney(.006), '¥0.0432 / $0.006');
});

test('catalog refresh preserves both text retail prices and video markup', () => {
  for (const model of [{alias:'gpt-5.6-sol',category:'chat'}, {alias:'kling-v3',category:'video'}]) {
    const priced = {...model,...trialPrice(model)};
    const refreshed = {inputPrice:999,outputPrice:999,pricing:null,...preserveRetailPrice(priced)};
    assert.deepEqual(refreshed.pricing,priced.pricing);
    assert.equal(refreshed.inputPrice,priced.inputPrice);
  }
  assert.deepEqual(preserveRetailPrice({pricing:null}),{});
});
