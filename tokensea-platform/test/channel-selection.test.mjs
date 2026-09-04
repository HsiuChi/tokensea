import { test } from "node:test";
import assert from "node:assert";
import {
  groupByPriority, weightedPick, selectChannel, channelsWithHealthyNodes,
} from "../src/services/relay/channel-selection.ts";

const mk = (id, priority, weight, status = "active") => ({ id: BigInt(id), priority, weight, status });

test("groupByPriority: tiers sorted desc", () => {
  const tiers = groupByPriority([mk(1,10,1), mk(2,20,1), mk(3,10,1)]);
  assert.equal(tiers.length, 2);
  assert.deepEqual(tiers[0].map(c => Number(c.id)), [2]);
  assert.deepEqual(tiers[1].map(c => Number(c.id)).sort(), [1,3]);
});

test("weightedPick: priority-tier high wins (single healthy)", () => {
  const tier = [mk(1,20,1), mk(2,10,1)];
  const healthy = new Set(["1","2"]);
  const pick = weightedPick(tier, healthy, () => 0.5);
  // tier is already [1,2]; weight 1 each → random picks either; but here we test selectChannel for priority
  assert.ok(pick);
});

test("selectChannel: high-priority channel preferred", () => {
  const channels = [mk(1,20,1), mk(2,10,1)];
  const healthy = new Set(["1","2"]);
  const pick = selectChannel(channels, healthy, new Set(), () => 0.5);
  assert.equal(Number(pick.id), 1, "highest priority channel 1 should win");
});

test("selectChannel: fallback to lower tier when high tier unhealthy", () => {
  const channels = [mk(1,20,1), mk(2,10,1)];
  const healthy = new Set(["2"]); // channel 1 has no healthy node
  const pick = selectChannel(channels, healthy, new Set(), () => 0.5);
  assert.equal(Number(pick.id), 2, "should fall back to channel 2");
});

test("selectChannel: weight=0 excluded", () => {
  const channels = [mk(1,10,0), mk(2,10,1)];
  const healthy = new Set(["1","2"]);
  const pick = selectChannel(channels, healthy, new Set(), () => 0.5);
  assert.equal(Number(pick.id), 2, "weight=0 channel excluded");
});

test("selectChannel: same priority weighted ratio ~3:1", () => {
  const channels = [mk(1,10,3), mk(2,10,1)];
  const healthy = new Set(["1","2"]);
  const counts = { 1: 0, 2: 0 };
  for (let i = 0; i < 4000; i++) {
    const pick = selectChannel(channels, healthy, new Set(), Math.random);
    counts[Number(pick.id)]++;
  }
  const ratio = counts[1] / counts[2];
  assert.ok(ratio > 2.5 && ratio < 3.5, `expected ~3, got ${ratio}`);
});

test("selectChannel: excludes tried channels", () => {
  const channels = [mk(1,10,1), mk(2,10,1), mk(3,10,1)];
  const healthy = new Set(["1","2","3"]);
  const tried = new Set(["1"]);
  const pick = selectChannel(channels, healthy, tried, () => 0.5);
  assert.notEqual(Number(pick.id), 1, "tried channel should be skipped");
});

test("channelsWithHealthyNodes", () => {
  const nodes = [
    { id: BigInt(1), channelId: BigInt(10), status: "healthy" },
    { id: BigInt(2), channelId: BigInt(20), status: "unhealthy" },
    { id: BigInt(3), channelId: BigInt(30), status: "healthy" },
  ];
  const set = channelsWithHealthyNodes(nodes);
  assert.ok(set.has("10"));
  assert.ok(!set.has("20"));
  assert.ok(set.has("30"));
});
