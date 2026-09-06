import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { badRequest, notFound } from "../../lib/errors.js";
import { upstreamHeaders, upstreamUrl } from "../channel/upstream-request.js";
import { ReservationService } from "./reservation-service.js";
import { quoteVideo } from "./video-pricing.js";

const serialize = (v: any) => JSON.parse(JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x));
function canonical(v: any): any {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
export const videoRequestHash = (model: string, body: any) => createHash("sha256").update(JSON.stringify(canonical({model,body}))).digest("hex");

/** Jobs live in the reservation payload: one durable ID, one owner, one original upstream node. */
export class VideoTaskService {
  constructor(private p: PrismaClient) {}

  async submit(id: string, keyId: bigint, alias: any, body: any, node: any, multiplier: number, upstreamModel: string, suffix: string) {
    const quote = quoteVideo(alias.alias, body, Number(alias.pricing?.cnyPerUsd ?? process.env.KSYUN_CNY_PER_USD ?? 7.2));
    if (suffix !== quote.detail.path) throw badRequest("Use the supported video creation path: " + quote.detail.path);
    if (node.adapter !== "ksyun" || upstreamModel !== alias.alias) throw badRequest("Video price is only validated for the matching KSP model route");
    const billing = new ReservationService(this.p), fingerprint = videoRequestHash(alias.alias, body);
    const r = await billing.reserve(id, keyId, alias, body, {[node.channelId.toString()]:multiplier});
    const job: any = { state:"submitting", fingerprint, family:quote.detail.family, path:quote.detail.path,
      model:alias.alias, nodeId:String(node.id), upstreamModel, createdAt:new Date().toISOString(),
      ctx:{model:alias.alias,upstreamModel,channelId:String(node.channelId),nodeId:String(node.id),startedAt:r.createdAt.toISOString()} };
    // Claim dispatch exactly once. Retries never resubmit an ambiguous accepted job.
    const claimed = await this.p.billingReservation.updateMany({where:{requestId:id,status:"reserved",payload:{equals:Prisma.DbNull}},data:{payload:serialize({videoJob:job})}});
    if (!claimed.count) {
      const existing = await this.p.billingReservation.findUniqueOrThrow({where:{requestId:id}});
      if ((existing.payload as any)?.videoJob?.fingerprint !== fingerprint) throw badRequest("Idempotency-Key was already used with different video parameters");
      return this.publicTask(existing);
    }
    const path = "/" + upstreamModel + "/" + job.path;
    let response: Response, result: any;
    try {
      response = await fetch(upstreamUrl(node.internalUrl,path), {method:"POST",headers:{...upstreamHeaders(node,path),"content-type":"application/json","x-request-id":id},
        body:JSON.stringify(quote.upstreamBody),signal:AbortSignal.timeout(60000)});
      result = await response.json();
    } catch {
      await this.review(id,"video_submission_outcome_unknown");
      return this.get(r.userId,alias.alias,id);
    }
    const taskId = result?.id ?? result?.data?.task_id ?? result?.task_id;
    // Hailuo returns HTTP 200 + business code 2013 for a definitive parameter rejection.
    if (!taskId && ([400,401,403,404,413,422].includes(response.status) || result?.base_resp?.status_code === 2013)) {
      job.state = "failed";
      await billing.finishVideo(id,job,"failed");
      return this.get(r.userId,alias.alias,id);
    }
    if (!response.ok || typeof taskId !== "string" || !/^[a-zA-Z0-9_-]{1,180}$/.test(taskId)) {
      // An HTTP error alone is not proof that an asynchronous provider did not create/charge a task.
      await this.review(id,"video_submission_not_confirmed");
      return this.get(r.userId,alias.alias,id);
    }
    job.upstreamId = taskId; job.state = "running";
    job.nextPollAt = new Date(Date.now()+10000).toISOString();
    await this.p.billingReservation.updateMany({where:{requestId:id,status:"reserved"},data:{payload:serialize({videoJob:job})}});
    return this.get(r.userId,alias.alias,id);
  }

  private async review(id: string, reason: string) {
    await this.p.billingReservation.updateMany({where:{requestId:id,status:"reserved"},data:{status:"review",reason}});
  }

  async get(userId: bigint, model: string, id: string) {
    const row = await this.p.billingReservation.findFirst({where:{requestId:id,userId}});
    if (!row || (row.payload as any)?.videoJob?.model !== model) throw notFound("Video task not found");
    return this.publicTask(row);
  }

  async list(userId: bigint) {
    const rows = await this.p.billingReservation.findMany({where:{userId,NOT:{payload:{path:['videoJob','model'],equals:Prisma.DbNull}}},orderBy:{createdAt:'desc'},take:100});
    return rows.filter(row=>(row.payload as any)?.videoJob?.model).map(row=>this.publicTask(row));
  }

  async existingSubmission(userId:bigint,keyId:bigint,model:string,id:string,body:any) {
    const row=await this.p.billingReservation.findFirst({where:{requestId:id,userId,apiKeyId:keyId}});
    if(!(row?.payload as any)?.videoJob)return null;
    if((row!.payload as any).videoJob.fingerprint!==videoRequestHash(model,body))throw badRequest('Idempotency-Key was already used with different video parameters');
    return this.publicTask(row);
  }

  private publicTask(row: any) {
    const job = row.payload?.videoJob;
    const status = row.status === "review" ? "review" : job?.state ?? "submitting";
    return { id:row.requestId, task_id:row.requestId, object:"video.task", model:job?.model, status, createdAt:row.createdAt,
      data:{task_id:row.requestId,task_status:status},
      result:job?.result ?? null,
      billing:{status:row.status,reservedUsd:Number(row.amount)/1e6,chargedUsd:Number(row.charged)/1e6,
        reason:row.reason ?? null}, pollUrl:"/v1/video/"+job?.model+"/tasks/"+row.requestId };
  }

  async recover() {
    const rows = await this.p.billingReservation.findMany({where:{status:"reserved",payload:{path:["videoJob","state"],equals:"running"}},
      orderBy:{updatedAt:"asc"},take:12});
    for (let i=0;i<rows.length;i+=3) await Promise.all(rows.slice(i,i+3).map(row=>this.poll(row).catch(()=>undefined)));
  }

  private async poll(row: any) {
    const job = row.payload.videoJob;
    if (Date.parse(job.nextPollAt ?? "") > Date.now()) return;
    const node = await this.p.channelNode.findUnique({where:{id:BigInt(job.nodeId)}});
    if (!node) { await this.review(row.requestId,"video_original_node_missing"); return; }
    const suffix = job.family === "hailuo" ? "v1/query/video_generation?task_id="+encodeURIComponent(job.upstreamId)
      : job.path+"/"+encodeURIComponent(job.upstreamId);
    const path = "/"+job.upstreamModel+"/"+suffix;
    let result: any;
    try {
      const response = await fetch(upstreamUrl(node.internalUrl,path),{headers:upstreamHeaders(node,path),signal:AbortSignal.timeout(30000)});
      if (!response.ok) throw Error("poll_failed");
      result = await response.json();
    } catch {
      job.nextPollAt = new Date(Date.now()+60000).toISOString();
      await this.p.billingReservation.updateMany({where:{requestId:row.requestId,status:"reserved",updatedAt:row.updatedAt},data:{payload:serialize({videoJob:job})}});
      return;
    }
    const returnedId = result.id ?? result.data?.task_id ?? result.task_id;
    if (String(returnedId) !== job.upstreamId) { await this.review(row.requestId,"video_poll_identity_mismatch"); return; }
    if ((result.code !== undefined && result.code !== 0) || (result.base_resp?.status_code !== undefined && result.base_resp.status_code !== 0)) {
      await this.review(row.requestId,"video_poll_result_not_confirmed"); return;
    }
    const state = String(result.status ?? result.data?.task_status ?? "").toLowerCase();
    if (["failed","fail"].includes(state)) {
      job.state = "failed";
      await new ReservationService(this.p).finishVideo(row.requestId,job,"failed");
    } else if (["succeeded","succeed","success"].includes(state)) {
      if (job.family === "kling" && (!Array.isArray(result.data?.task_result?.videos) || result.data.task_result.videos.length !== 1)) {
        await this.review(row.requestId,"video_result_count_not_confirmed"); return;
      }
      const reportedDuration = result.data?.task_result?.videos?.[0]?.duration;
      const quotedDuration = (row.pricing as any).estimate.seconds;
      // Live Kling 3-second output reports 3.041s (one encoded tail frame).
      // Keep the requested, quoted duration; tolerate <=50ms container rounding only.
      if (job.family === "kling" && reportedDuration !== undefined
        && (!Number.isFinite(Number(reportedDuration)) || Math.abs(Number(reportedDuration)-quotedDuration) > 0.05)) {
        await this.review(row.requestId,"video_result_duration_differs_from_quote"); return;
      }
      if (job.family === "hailuo" && !result.file_id) {
        await this.review(row.requestId,"video_result_file_missing"); return;
      }
      job.state = "succeeded";
      // Store only result media fields, not provider request metadata or upstream credentials.
      job.result = job.family === "seedance" ? {content:result.content}
        : job.family === "kling" ? {videos:result.data?.task_result?.videos}
        : {file_id:result.file_id,video_width:result.video_width,video_height:result.video_height};
      if (job.family === "hailuo" && result.file_id) {
        const filePath = "/"+job.upstreamModel+"/v1/files/retrieve?file_id="+encodeURIComponent(result.file_id);
        try {
          const file = await fetch(upstreamUrl(node.internalUrl,filePath),{headers:upstreamHeaders(node,filePath),signal:AbortSignal.timeout(30000)});
          const data = await file.json() as any;
          if (!file.ok || !data.file?.download_url) throw Error("file_pending");
          job.result = {download_url:data.file.download_url,video_width:result.video_width,video_height:result.video_height};
        } catch { return; } // Retry bound file retrieval; no arbitrary user-controlled file IDs.
      }
      const tokens = result.usage?.total_token ?? result.usage?.completion_tokens ?? result.usage?.total_tokens;
      await new ReservationService(this.p).finishVideo(row.requestId,job,"succeeded",tokens);
    } else {
      job.nextPollAt = new Date(Date.now()+15000).toISOString();
      await this.p.billingReservation.updateMany({where:{requestId:row.requestId,status:"reserved",updatedAt:row.updatedAt},data:{payload:serialize({videoJob:job})}});
    }
  }
}
