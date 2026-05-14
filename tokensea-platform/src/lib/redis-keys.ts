const PREFIX = "tokensea";

export const redisKeys = {
  // Quota
  userRequestCount: (userId: bigint, period: string) =>
    `${PREFIX}:quota:user:${userId}:period:${period}`,
  userTokenCount: (userId: bigint, period: string) =>
    `${PREFIX}:quota:user:${userId}:tokens:${period}`,
  userDailySpending: (userId: bigint, date: string) =>
    `${PREFIX}:quota:user:${userId}:daily:${date}`,
  keyRequestCount: (apiKeyId: bigint, period: string) =>
    `${PREFIX}:quota:key:${apiKeyId}:period:${period}`,
  keyDailySpending: (apiKeyId: bigint, date: string) =>
    `${PREFIX}:quota:key:${apiKeyId}:daily:${date}`,

  // Rate limiting
  qps: (userId: bigint) => `${PREFIX}:ratelimit:user:${userId}:qps`,
  rpm: (userId: bigint) => `${PREFIX}:ratelimit:user:${userId}:rpm`,
  tpm: (userId: bigint) => `${PREFIX}:ratelimit:user:${userId}:tpm`,

  // Session affinity
  session: (userId: bigint) => `${PREFIX}:session:${userId}`,

  // Node cooldown
  nodeCooldown: (nodeId: bigint) => `${PREFIX}:cooldown:node:${nodeId}`,

  // Node health — headroom snapshot polled from dario /accounts
  nodeHealth: (nodeId: bigint) => `${PREFIX}:health:node:${nodeId}`,
};
