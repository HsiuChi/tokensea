export const VIDEO_MODELS = ['seedance-2.5','seedance-2.0-domestic','kling-v3','kling-v3-omni','hailuo-2.3','hailuo-2.3-fast','hailuo-02'];
export type VideoSettings = {prompt:string;image:string;duration:number;resolution:string;ratio:string;sound:boolean;quality:string};
export function videoDefaults(model:string):VideoSettings {
  return {prompt:'',image:'',duration:model.startsWith('hailuo')?6:5,resolution:model.startsWith('hailuo')?'768P':'720p',ratio:'16:9',sound:false,quality:'std'};
}
export function safeMediaUrl(value:unknown):string|undefined {
  if(typeof value!=='string')return;
  try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password)return u.href;}catch{}
}
export function videoRequest(model:string,s:VideoSettings) {
  if(!VIDEO_MODELS.includes(model))throw Error('此模型尚未开放视频工作台');
  const prompt=s.prompt.trim();
  if(!prompt||prompt.length>5000)throw Error('请输入 1–5000 字的提示词');
  const image=s.image.trim();
  if(image&&!safeMediaUrl(image))throw Error('参考图需要不含账户密码的公开 HTTPS 图片链接');
  if(model==='kling-v3-omni'&&image)throw Error('Omni 暂未开放参考图');
  if(model==='hailuo-2.3-fast'&&!image)throw Error('海螺 Fast 需要参考图');
  if(model.startsWith('seedance'))return {path:'v3/contents/generations/tasks',body:{model,content:[{type:'text',text:prompt},...(image?[{type:'image_url',image_url:{url:image}}]:[])],duration:s.duration,resolution:s.resolution,ratio:s.ratio,generate_audio:s.sound}};
  if(model.startsWith('kling'))return {path:model.endsWith('omni')?'v1/videos/omni-video':image?'v1/videos/image2video':'v1/videos/text2video',body:{model_name:model,prompt,duration:s.duration,mode:s.quality,sound:s.sound?'on':'off',aspect_ratio:s.ratio,...(image?{image}:{})}};
  return {path:'v1/video_generation',body:{model,prompt,duration:s.duration,resolution:s.resolution,...(image?{first_frame_image:image}:{})}};
}
export function resultVideo(task:any) {
  return safeMediaUrl(task.result?.download_url??task.result?.videos?.[0]?.url??task.result?.content?.video_url);
}
export const VIDEO_STATUS:Record<string,string>={submitting:'正在提交',running:'生成中',succeeded:'已完成',failed:'生成失败',review:'待人工核对'};
