import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { encryptUpstreamSecret, maskUpstreamSecret, upstreamSecretFingerprint } from "../src/lib/upstream-secret.js";

const prisma = new PrismaClient();
let migrated = 0;

try {
  const nodes = await prisma.channelNode.findMany();
  for (const node of nodes) {
    if (node.internalApiKey.startsWith("enc:v1:")) continue;
    const rawKey = node.internalApiKey;
    await prisma.channelNode.update({
      where: { id: node.id },
      data: {
        internalApiKey: encryptUpstreamSecret(rawKey),
        keyFingerprint: upstreamSecretFingerprint(rawKey),
        keyPrefix: maskUpstreamSecret(rawKey),
      },
    });
    migrated++;
  }
  console.log(`Encrypted ${migrated} upstream credential(s).`);
} finally {
  await prisma.$disconnect();
}
