// Exact IDs verified against publisher model cards on 2026-09-06.
// Model input capability is not permission to advertise a new output endpoint.
export const REVIEWED_VISION_MODELS = new Set([
  'gpt-6-astra','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-5.5',
  'glm-5.3-flash','kimi-k3','kimi-k2.6','kimi-k2.7-code','kimi-k2.7-code-highspeed','mimo-v2.5',
]);
export function modelCapabilities(model:{alias:string;category:string;supportsVision?:boolean}) {
  const imageInput=model.category==='vision'||!!model.supportsVision||REVIEWED_VISION_MODELS.has(model.alias);
  const textOutput=['chat','vision'].includes(model.category);
  const visionUnderstanding=textOutput&&imageInput;
  // Image/video output is advertised only for the corresponding integrated endpoint.
  const categories=[...(textOutput?['chat']:[]),...(visionUnderstanding?['vision']:[]),...(!textOutput?[model.category]:[])];
  return {imageInput,visionUnderstanding,imageGeneration:model.category==='image',videoGeneration:model.category==='video',categories};
}
export function withCapabilities<T extends {alias:string;category:string;supportsVision?:boolean}>(model:T) {
  const capabilities=modelCapabilities(model);
  return {...model,supportsVision:capabilities.imageInput,capabilities};
}
