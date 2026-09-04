import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { KSYUN_MODELS } from "../src/config/ksyun-model-catalog.js";
import { ChannelService } from "../src/services/channel/channel-service.js";
import { decryptUpstreamSecret } from "../src/lib/upstream-secret.js";

const prisma = new PrismaClient();
const rollbackMarker = "KSYUN_BOOTSTRAP_VERIFIED";

try {
  await prisma.$transaction(async (tx) => {
    const service = new ChannelService(tx as unknown as PrismaClient);
    const result = await service.bootstrapKsyun({
      channelName: "__KSP bootstrap verification__",
      apiKeys: ["sk-verification-placeholder-0001", "sk-verification-placeholder-0002"],
      modelIds: KSYUN_MODELS.map((model) => model.id),
    });
    assert.equal(result.addedKeys, 2);
    assert.equal(result.models.length, KSYUN_MODELS.length);

    const nodes = await tx.channelNode.findMany({ where: { channelId: result.channelId } });
    assert.equal(nodes.length, 2);
    assert.ok(nodes.every((node) => node.internalApiKey.startsWith("enc:v1:")));
    assert.equal(decryptUpstreamSecret(nodes[0].internalApiKey), "sk-verification-placeholder-0001");

    const routeCount = await tx.modelRoute.count({ where: { channelId: result.channelId } });
    assert.equal(routeCount, KSYUN_MODELS.length);
    throw new Error(rollbackMarker);
  });
} catch (error) {
  if (!(error instanceof Error) || error.message !== rollbackMarker) throw error;
  console.log(`Verified encrypted KSP key pool and ${KSYUN_MODELS.length} model routes (transaction rolled back).`);
} finally {
  await prisma.$disconnect();
}
