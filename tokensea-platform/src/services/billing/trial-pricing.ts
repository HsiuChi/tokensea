import { CNY_PER_USD } from '../../shared/money.js';

export const TRIAL_VERSION = 'trial-cost-plus-2026-09-05';
export const MARKUP = 1.5;
// Business assumption only: NOT an official Pro quota or a measured capacity.
export const PRO_ASSUMPTION = { monthlyCostUsd: 100, monthlyApiEquivalentUsd: 500, costRatio: .2, measured: false };
const OPENAI: Record<string, number[]> = {
  'gpt-6-astra': [10, 50, 1, 12.5],
  'gpt-5.6-sol': [4, 20, .4, 5],
  'gpt-5.6-terra': [2, 12, .2, 2.5],
  'gpt-5.6-luna': [.2, 1.2, .02, .25],
  'gpt-5.5': [5, 30, .5, 0],
  'gpt-image-2': [5, 30, 1.25, 0],
};
const rates = (r: number[]) => ({inputPrice:r[0],outputPrice:r[1],cacheReadPrice:r[2],cacheWrite5mPrice:r[3]??0,cacheWrite1hPrice:0});
const scale = (r: Record<string,number>, factor:number) => Object.fromEntries(Object.entries(r).map(([k,v])=>[k,Number((v*factor).toFixed(9))]));

/** Idempotent: always derive sales prices from cost/reference, never current sales prices. */
export function trialPrice(model: any): any | null {
  const official=OPENAI[model.alias];
  const old=model.pricing??{};
  const meta={version:TRIAL_VERSION,markup:MARKUP,estimated:true};
  if(official){
    const reference=rates(official),cost=scale(reference,PRO_ASSUMPTION.costRatio),sale=scale(cost,MARKUP);
    const rules:any=model.category==='image'
      ?{imageInputPrice:8*.3,imageCacheReadPrice:2*.3}
      :{longContext:{threshold:272000,inputMultiplier:2,outputMultiplier:1.5}};
    const costRules=model.category==='image'?{imageInputPrice:8*.2,imageCacheReadPrice:2*.2}:rules;
    return {...sale,pricing:{currency:'USD',unit:'1M tokens',cnyPerUsd:CNY_PER_USD,priceVersion:TRIAL_VERSION,...rules,
      internalCost:{...meta,kind:'subscription_assumption',...PRO_ASSUMPTION,prices:cost,rules:costRules,officialReference:reference}}};
  }
  if(model.category==='video' && /^(seedance|kling|hailuo)-/.test(model.alias)){
    return {pricing:{currency:'USD',cnyPerUsd:CNY_PER_USD,priceVersion:TRIAL_VERSION,saleMultiplier:MARKUP,
      internalCost:{...meta,kind:'upstream_video_rate_card',source:'https://docs.ksyun.com/documents/44741'} }};
  }
  const upstream=old.upstreamCny??old.internalCost?.upstreamCny;
  if(upstream){
    // Zero catalog price is not verified zero acquisition cost: apply an explicit operational floor.
    const zero=Number(upstream.input)===0&&Number(upstream.output)===0;
    const costCny=zero?{input:1,output:4,cacheRead:.1}:upstream;
    const cost=rates([costCny.input/CNY_PER_USD,costCny.output/CNY_PER_USD,costCny.cacheRead/CNY_PER_USD,0]);
    return {...scale(cost,MARKUP),pricing:{currency:'USD',unit:'1M tokens',cnyPerUsd:CNY_PER_USD,priceVersion:TRIAL_VERSION,
      internalCost:{...meta,kind:zero?'operational_floor_assumption':'upstream_catalog_assumption',prices:cost,upstreamCny:upstream,costCny}}};
  }
  return null;
}

export function publicPricing(pricing:any) {
  if(!pricing)return pricing;
  const {internalCost,upstreamCny,source,sourceUrl,...safe}=pricing;
  return safe;
}
export function publicBillingDetail(detail:any) {
  if(!detail)return detail;
  const {internalCost,...safe}=detail;
  return safe;
}

/** Catalog refreshes must not replace an explicitly configured retail tariff. */
export function preserveRetailPrice(model:any) {
  if (!model?.pricing?.priceVersion) return {};
  return Object.fromEntries(['inputPrice','outputPrice','cacheReadPrice','cacheWrite5mPrice','cacheWrite1hPrice','pricing'].map(k=>[k,model[k]]));
}
