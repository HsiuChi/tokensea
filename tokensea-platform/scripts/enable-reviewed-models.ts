import { PrismaClient } from "@prisma/client";
import { writeFile } from "node:fs/promises";
import { REVIEWED_OPENAI_MODELS } from "../src/config/reviewed-openai-models.js";
import { probeCpa } from "../src/services/channel/upstream-request.js";
const prisma = new PrismaClient();
try {
  const channelId = BigInt(process.env.CPA_CHANNEL_ID ?? "2");
  const channel = await prisma.channel.findUnique({where:{id:channelId},include:{nodes:true}});
  if(!channel || channel.status !== "active") throw new Error("Active CPA channel required");
  const node = channel.nodes.find(n=>n.adapter==="cpa");
  if(!node) throw new Error("CPA node required");
  const catalogue = await probeCpa(node);
  if(!catalogue.healthy || REVIEWED_OPENAI_MODELS.some(m=>!catalogue.models.some(u=>u.id===m.alias))) throw new Error("Reviewed models unavailable upstream");
  const before = await prisma.modelAlias.findMany({where:{alias:{in:REVIEWED_OPENAI_MODELS.map(m=>m.alias)}},include:{routes:true}});
  if(before.length!==2) throw new Error("Expected exactly two existing candidates");
  if(!process.argv.includes("--apply")) {console.log("Dry run: two reviewed models, standard API reference pricing, ready");}
  else {
    const backup = "/tmp/tokensea-model-pricing-" + Date.now() + ".json";
    await writeFile(backup, JSON.stringify(before,(_,v)=>typeof v==="bigint"?v.toString():v,2),{mode:0o600});
    await prisma.$transaction(async tx=>{
      for(const model of REVIEWED_OPENAI_MODELS) {
        const existing=before.find(m=>m.alias===model.alias)!;
        if(!existing.routes.some(r=>r.channelId===channelId)) throw new Error("Missing reviewed route");
        await tx.modelAlias.update({where:{id:existing.id},data:{...model,status:"active"}});
        await tx.modelRoute.updateMany({where:{aliasId:existing.id,channelId},data:{status:"active"}});
      }
    });
    console.log(JSON.stringify({enabled:REVIEWED_OPENAI_MODELS.map(m=>m.alias),backup}));
  }
} finally { await prisma.$disconnect(); }
