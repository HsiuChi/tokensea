import test from 'node:test';
import assert from 'node:assert/strict';
import {VIDEO_MODELS,videoDefaults,videoRequest,resultVideo} from '../web/src/lib/video-workbench.ts';
import {quoteVideo} from '../src/services/billing/video-pricing.ts';
import {RelayService} from '../src/services/relay/relay-service.ts';
import {signToken} from '../src/lib/jwt.ts';

test('all offered workbench models build requests accepted by the billing adapter',()=>{
  for(const model of VIDEO_MODELS){
    const s={...videoDefaults(model),prompt:'海面上的帆船',...(model.endsWith('fast')?{image:'https://example.com/a.png'}:{})};
    const req=videoRequest(model,s),quote=quoteVideo(model,req.body,7.2,1,1,1.5);
    assert.equal(req.path,quote.detail.path);
    assert(quote.amount>0n);
  }
});
test('image reference dispatch, result URLs and unsupported models are guarded',()=>{
  const s={...videoDefaults('kling-v3'),prompt:'test',image:'https://example.com/ref.png'};
  assert.equal(videoRequest('kling-v3',s).path,'v1/videos/image2video');
  assert.throws(()=>videoRequest('kling-v3-omni',s));
  assert.throws(()=>videoRequest('seedance-2.0-o',s));
  assert.throws(()=>videoRequest('hailuo-2.3-fast',{...s,image:''}));
  assert.throws(()=>videoRequest('kling-v3',{...s,image:'javascript:alert(1)'}));
  assert.equal(resultVideo({result:{videos:[{url:'javascript:alert(1)'}]}}),undefined);
  for(const result of [{videos:[{url:'https://example.com/a.mp4'}]},{download_url:'https://example.com/a.mp4'},{content:{video_url:'https://example.com/a.mp4'}}])assert.equal(resultVideo({result}),'https://example.com/a.mp4');
});
test('JWT selected billing key remains owner scoped and does not fall back to another key',async()=>{
  let where;
  const svc=new RelayService({apiKey:{findFirst:async args=>{where=args.where;return args.where.id===2n?{id:2n,status:'active',allowedIps:[]}:null}}},{});
  const req={headers:{authorization:'Bearer '+signToken({userId:7n,role:'user'},'test-secret','1h'),'x-tokensea-key-id':'2'},server:{env:{JWT_SECRET:'test-secret'}},ip:'127.0.0.1'};
  assert.equal((await svc.resolveApiKey(req)).id,2n);
  assert.equal(where.userId,7n);assert.equal(where.deletedAt,null);
  await assert.rejects(svc.resolveApiKey({...req,headers:{...req.headers,'x-tokensea-key-id':'3'}}));
  await assert.rejects(svc.resolveApiKey({...req,headers:{...req.headers,'x-tokensea-key-id':'-1'}}));
});
