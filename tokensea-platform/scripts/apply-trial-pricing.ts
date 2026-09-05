import { PrismaClient, Prisma } from '@prisma/client';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { trialPrice, TRIAL_VERSION } from '../src/services/billing/trial-pricing.js';

const prisma = new PrismaClient();
const encode = (v:unknown) => JSON.stringify(v, (_,x)=>typeof x==='bigint'?x.toString():x, 2);
// Prisma/JSONB can round the last binary-float digit. Retail rates have 9 decimals;
// ignore only sub-precision noise in estimated internal cost metadata.
const canonical = (v:any):string => JSON.stringify(v,(_,x)=>typeof x==='number'?Number(x.toPrecision(14)):x && typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const apply = process.argv.includes('--apply');
try {
  await prisma.$transaction(async tx => {
    const models = await tx.modelAlias.findMany({where:{status:'active'},include:{routes:true},orderBy:{alias:'asc'}});
    const selected = models.map(model=>({model,price:trialPrice(model)})).filter(row=>row.price);
    if (!selected.length) throw Error('No eligible active models');
    const channelIds = [...new Set(selected.flatMap(row=>row.model.routes.map(r=>r.channelId)))];
    const channels = await tx.channel.findMany({where:{id:{in:channelIds}},select:{id:true,name:true,type:true,billingMultiplier:true}});
    // Reset only fully covered channels. Never silently change unrelated models' charges.
    for (const channel of channels) {
      if (!['codex','custom'].includes(channel.type)) throw Error('Unexpected channel type: '+channel.name);
      if (models.some(m=>m.routes.some(r=>r.channelId===channel.id)&&!selected.some(s=>s.model.id===m.id))) throw Error('Unpriced model shares channel: '+channel.name);
    }
    const changed = selected.filter(({model,price})=>Object.entries(price).some(([k,v])=>canonical((model as any)[k])!==canonical(v)));
    const changedChannels = channels.filter(c=>c.billingMultiplier!==1);
    console.log(encode({mode:apply?'apply':'dry-run',version:TRIAL_VERSION,models:selected.map(({model,price})=>({alias:model.alias,inputUsd:price.inputPrice,outputUsd:price.outputPrice,videoMultiplier:price.pricing.saleMultiplier})),changedModels:changed.length,resetChannels:changedChannels.map(c=>({name:c.name,from:c.billingMultiplier,to:1}))}));
    if (!apply || (!changed.length&&!changedChannels.length)) return;
    if (!process.env.PRICING_BACKUP_DIR) throw Error('PRICING_BACKUP_DIR is required');
    const backup = resolve(process.env.PRICING_BACKUP_DIR,`pricing-before-${Date.now()}.json`);
    await writeFile(backup,encode({version:TRIAL_VERSION,models:selected.map(s=>s.model),channels}),{mode:0o600,flag:'wx'});
    for (const {model,price} of changed) await tx.modelAlias.update({where:{id:model.id},data:price});
    for (const channel of changedChannels) await tx.channel.update({where:{id:channel.id},data:{billingMultiplier:1}});
    await tx.auditLog.create({data:{actorName:'pricing-deploy',action:'trial_pricing.apply',targetType:'pricing',targetId:TRIAL_VERSION,detail:{models:changed.map(s=>s.model.alias),channels:changedChannels.map(c=>c.id.toString()),backup}}});
    console.log('Pricing applied; rollback snapshot: '+backup);
  }, {isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
} finally { await prisma.$disconnect(); }
