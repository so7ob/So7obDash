import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createDashboardServer} from './index.ts';
import {config} from './config.ts';
import {passwordHash, sessionStore, sessionTtlMs, verifySignature} from './security.ts';

test('startup rejects implicit mode or publicly bound demo',()=>{
 assert.throws(()=>config({}),/explicitly/);
 assert.throws(()=>config({SO7OB_MODE:'demo',HOST:'0.0.0.0'}),/loopback/);
 assert.throws(()=>config({SO7OB_MODE:'live',PUBLIC_ORIGIN:'http://example.com'}),/HTTPS/);
});
test('sessions are opaque, revocable, and expire',()=>{
 let now=1;const s=sessionStore(()=>now),a=s.create(),b=s.create();
 assert.notEqual(a,b);assert.ok(s.valid(a));s.remove(a);assert.ok(!s.valid(a));
 now+=sessionTtlMs;assert.ok(!s.valid(b));
});
test('webhook signature verifies the exact raw bytes',()=>{
 const body=Buffer.from('{"a":1}'), secret='demo';
 const sig='sha256='+createHmac('sha256',secret).update(body).digest('hex');
 assert.ok(verifySignature(body,sig,secret));assert.ok(!verifySignature(Buffer.from('{"a":2}'),sig,secret));assert.ok(!verifySignature(body,'sha256=x',secret));
});
async function start(c, sync){
 const s=createDashboardServer(c,sync);
 await new Promise((ok,no)=>{s.once('error',no);s.listen(0,'127.0.0.1',ok)});
 const base='http://127.0.0.1:'+s.address().port;
 return {base,close:()=>new Promise(ok=>s.close(ok))};
}
test('demo bootstrap explicitly returns sample data; GitHub webhook is unavailable',async()=>{
 const c=config({SO7OB_MODE:'demo'}),{base,close}=await start(c);
 try{
   const r=await fetch(base+'/api/bootstrap');const d=await r.json();
   assert.equal(d.mode,'demo');assert.equal(d.connections.length,2);assert.equal(r.headers.get('cache-control'),'no-store');
   assert.equal((await fetch(base+'/api/webhooks/github',{method:'POST'})).status,404);
 }finally{await close()}
});
test('live authentication, origin, revoke refresh, and logout',async()=>{
 const password='a long demo integration password';
 const c={...config({SO7OB_MODE:'demo'}),mode:'live',origin:'https://hub.example.test',ownerHash:passwordHash(password),installations:['5'],webhookSecret:'demo secret used only in mocked test'};
 let syncs=0, fail=false;
 const {base,close}=await start(c,async()=>{
  syncs++;
  if(fail)throw Error('upstream failure contains sensitive details');
  return {mode:'live',connections:[],repositories:[{id:'known'}],syncErrors:[]};
 });
 const call=(path,init)=>fetch(base+path,init);
 const login=(passphrase,origin=c.origin)=>call('/api/login',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({passphrase})});
 try{
   assert.equal((await call('/api/bootstrap')).status,401);
   assert.equal((await login(password,'https://other.example.test')).status,403);
   assert.equal((await login('wrong')).status,401);
   const response=await login(password);assert.equal(response.status,200);
   const raw=response.headers.get('set-cookie');
   assert.match(raw,/HttpOnly; Secure; SameSite=Strict/);
   const cookie=raw.split(';')[0];
   const view=()=>call('/api/bootstrap',{headers:{cookie}});
   assert.equal((await view()).status,200);assert.equal(syncs,1);
   const body=JSON.stringify({installation:{id:5}}), signature='sha256='+createHmac('sha256',c.webhookSecret).update(body).digest('hex');
   const hook=(sig)=>call('/api/webhooks/github',{method:'POST',body,headers:{'x-hub-signature-256':sig,'x-github-event':'installation_repositories','x-github-delivery':'demo-test-1'}});
   assert.equal((await hook('bad')).status,401);
   fail=true;
   assert.equal((await hook(signature)).status,202);
   assert.equal((await (await hook(signature)).json()).duplicate,true);
   const unavailable=await view();assert.equal(unavailable.status,503);assert.doesNotMatch(await unavailable.text(),/sensitive/);
   assert.equal((await call('/api/logout',{method:'POST',headers:{cookie,origin:c.origin}})).status,200);
   assert.equal((await view()).status,401);
 }finally{await close()}
});
