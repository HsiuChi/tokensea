/**
 * Channel + node selection: priority-tiered + weight-weighted routing.
 *
 * Replaces the legacy "first channel with healthy nodes" behavior.
 * Channels are grouped by priority (desc). Within a priority tier,
 * a channel is picked by weighted random (channel.weight). If that
 * channel has no healthy nodes, re-pick within the tier; when the whole
 * tier is exhausted, fall through to the next priority tier.
 *
 * Pure functions (no Prisma/Redis) so they can be unit tested directly.
 */

export interface ChannelForRoute {
  id: bigint;
  priority: number;
  weight: number;
  status: string;
  billingMultiplier?: number;
  retryPolicy?: any;
}

export interface NodeForRoute {
  id: bigint;
  channelId: bigint;
  status: string;
}

/**
 * Group channels by priority (desc), preserving insertion order within a tier.
 */
export function groupByPriority(channels: ChannelForRoute[]): ChannelForRoute[][] {
  const map = new Map<number, ChannelForRoute[]>();
  for (const c of channels) {
    const tier = map.get(c.priority) ?? [];
    tier.push(c);
    map.set(c.priority, tier);
  }
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, tier]) => tier);
}

/**
 * Weighted random pick within a tier. weight<=0 channels are excluded.
 * Returns null if all candidates are excluded/unhealthy.
 */
export function weightedPick(
  tier: ChannelForRoute[],
  healthyChannelIds: Set<string>,
  rng: () => number = Math.random,
): ChannelForRoute | null {
  const eligible = tier.filter(
    (c) => c.weight > 0 && c.status === "active" && healthyChannelIds.has(c.id.toString()),
  );
  if (eligible.length === 0) return null;

  const total = eligible.reduce((s, c) => s + c.weight, 0);
  if (total <= 0) return eligible[0];

  let r = rng() * total;
  for (const c of eligible) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return eligible[eligible.length - 1];
}

/**
 * Select a channel across all priority tiers. Returns the chosen channel
 * and the set of channels still tried, so the caller can exclude it on retry.
 * Tries each tier top-down; within a tier, re-picks (up to tier size) on failure.
 */
export function selectChannel(
  channels: ChannelForRoute[],
  healthyChannelIds: Set<string>,
  triedChannelIds: Set<string>,
  rng: () => number = Math.random,
): ChannelForRoute | null {
  const tiers = groupByPriority(channels);
  for (const tier of tiers) {
    // Skip channels already tried in this request.
    const remaining = tier.filter((c) => !triedChannelIds.has(c.id.toString()));
    if (remaining.length === 0) continue;

    // Try up to remaining.length weighted picks within this tier.
    for (let attempt = 0; attempt < remaining.length; attempt++) {
      const pick = weightedPick(remaining, healthyChannelIds, rng);
      if (pick) return pick;
      break; // no eligible+healthy in remaining → next tier
    }
  }
  return null;
}

/**
 * Build the set of channel ids that currently have at least one healthy,
 * non-cooled-down node. Caller supplies the node list (already filtered
 * for status=healthy and not in Redis cooldown).
 */
export function channelsWithHealthyNodes(
  nodes: NodeForRoute[],
): Set<string> {
  const set = new Set<string>();
  for (const n of nodes) {
    if (n.status === "healthy") set.add(n.channelId.toString());
  }
  return set;
}
