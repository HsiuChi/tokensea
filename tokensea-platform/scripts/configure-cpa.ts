import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { probeCpa } from '../src/services/channel/upstream-request.js';
import { ChannelService } from '../src/services/channel/channel-service.js';

// Explicit production targets; no credential changes or Dario deletion.
const prisma = new PrismaClient();
try {
  const nodeId = BigInt(process.env.CPA_NODE_ID || '0');
  const channelId = BigInt(process.env.DARIO_CHANNEL_ID || '0');
  const node = await prisma.channelNode.findUniqueOrThrow({ where: { id: nodeId } });
  const channel = await prisma.channel.findUniqueOrThrow({ where: { id: channelId }, include: { nodes: true, routes: { include: { alias: true } } } });
  if (!new URL(node.internalUrl).hostname.includes('cpa')) throw new Error('Target is not a CPA endpoint');
  if (!channel.nodes.length || channel.nodes.some(n => n.adapter !== 'dario')) throw new Error('Expected a Dario-only channel');
  const probe = await probeCpa({ ...node, adapter: 'cpa' });
  if (!probe.healthy) throw new Error('CPA authenticated probe failed');
  const snapshot = {
    node: { id: String(node.id), adapter: node.adapter, authType: node.authType, probePath: node.probePath },
    channel: { id: String(channel.id), status: channel.status, probeEnabled: channel.probeEnabled },
    routes: channel.routes.map(r => ({ id: String(r.id), status: r.status, aliasId: String(r.aliasId), aliasStatus: r.alias.status })),
  };
  console.log(JSON.stringify({ cpaModels: probe.models.map(m => m.id), before: snapshot }));
  if (process.argv.includes('--apply')) {
    const backup = `/tmp/tokensea-cpa-before-${Date.now()}.json`;
    writeFileSync(backup, JSON.stringify(snapshot, null, 2), { mode: 0o600, flag: 'wx' });
    await prisma.$transaction(async tx => {
      await tx.channelNode.update({ where: { id: nodeId }, data: { adapter: 'cpa', authType: 'bearer', probePath: '/v1/models' } });
      await tx.channel.update({ where: { id: channelId }, data: { status: 'disabled', probeEnabled: false } });
      await tx.modelRoute.updateMany({ where: { channelId }, data: { status: 'inactive' } });
      for (const r of channel.routes) {
        const remaining = await tx.modelRoute.count({ where: { aliasId: r.aliasId, status: 'active', channel: { status: 'active' } } });
        if (!remaining) await tx.modelAlias.update({ where: { id: r.aliasId }, data: { status: 'inactive' } });
      }
    });
    const service = new ChannelService(prisma);
    console.log(JSON.stringify({ backup, sync: await service.syncCpaModels(node.channelId), health: await service.healthCheck(node.id) }));
  }
} finally { await prisma.$disconnect(); }
