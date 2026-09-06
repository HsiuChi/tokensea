import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {modelCapabilities,REVIEWED_VISION_MODELS} from '../src/config/model-capabilities.ts';
import {publicRoutes} from '../src/routes/public.ts';
import zh from '../web/src/i18n/zh.ts';
import en from '../web/src/i18n/en.ts';
test('reviewed vision models appear in both text and vision without changing output interface',()=>{
 for(const alias of REVIEWED_VISION_MODELS)assert.deepEqual(modelCapabilities({alias,category:'chat',supportsVision:false}).categories,['chat','vision']);
 assert.deepEqual(modelCapabilities({alias:'mimo-v2.5-pro',category:'chat'}).categories,['chat']);
 for(const category of ['video','image']){const c=modelCapabilities({alias:'fixture',category,supportsVision:true});assert.deepEqual(c.categories,[category]);assert.equal(c.visionUnderstanding,false);assert.equal(c.imageInput,true);}
 assert.equal(modelCapabilities({alias:'kling-v3',category:'video',supportsVision:true}).imageGeneration,false);
});
test('marketplace uses capability filtering and retains provider/search conditions',async()=>{
 const handlers={},rows=[{alias:'kimi-k3',category:'chat',supportsVision:false,pricing:null},{alias:'kling-v3',category:'video',supportsVision:true,pricing:null}];
 let queried;
 await publicRoutes({get:(path,handler)=>{handlers[path]=handler},prisma:{modelAlias:{findMany:async args=>{if(args.select.inputPrice){queried=args.where;return rows}if(args.select.provider)return [{provider:'moonshot'}];return rows}}}});
 const result=await handlers['/models']({query:{category:'vision',provider:'moonshot',search:'kimi'}});
 assert.deepEqual(result.data.map(m=>m.alias),['kimi-k3']);assert(result.categories.includes('vision'));assert.equal(queried.provider,'moonshot');assert(queried.OR);assert.equal(queried.category,undefined);
});
test('every translated chat key exists in both language dictionaries; default ignores navigator',()=>{
 const src=fs.readFileSync(new URL('../web/src/pages/Chat.tsx',import.meta.url),'utf8');
 for(const [,key]of src.matchAll(/(?:["'])chat\.([a-zA-Z]+)(?:["'])/g)){assert.equal(typeof zh.chat[key],'string',key);assert.equal(typeof en.chat[key],'string',key);}
 const config=fs.readFileSync(new URL('../web/src/i18n/index.ts',import.meta.url),'utf8');
 assert.match(config,/fallbackLng: "zh"/);assert.match(config,/order: \["localStorage"\]/);
});
