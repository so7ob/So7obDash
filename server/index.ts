import {createServer} from 'node:http';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {config} from './config.ts';
import type {Config} from './config.ts';
import {demo} from './demo.ts';
import {syncGitHub} from './github.ts';
import {fixedWindow,readSessionCookie,sessionCookie,sessionStore,sessionTtlMs,verifyPassword,verifySignature} from './security.ts';

const period=15*60_000, validity=20*60_000;
const assetTypes:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
class HttpError extends Error{
  readonly status:number;
  constructor(status:number,message:string){super(message);this.status=status}
}
function headers(res:ServerResponse){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
}
function json(res:ServerResponse,status:number,value:unknown){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(value));
}
async function readBody(req:IncomingMessage,limit:number){
  const chunks:Buffer[]=[];let size=0;
  const claimed=Number(req.headers['content-length']??0);
  if(claimed>limit){req.resume();throw new HttpError(413,'Request too large.')}
  for await(const chunk of req){
    const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=b.length;if(size>limit)throw new HttpError(413,'Request too large.');
    chunks.push(b);
  }
  return Buffer.concat(chunks,size);
}
const header=(req:IncomingMessage,k:string)=>typeof req.headers[k]==='string'?req.headers[k]:'';
function inputObject(raw:Buffer):Record<string,unknown>{
  try{
    const value:unknown=JSON.parse(raw.toString());
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected an object');
    return value as Record<string,unknown>;
  }catch{throw new HttpError(400,'Invalid JSON object.')}
}
type Sync=typeof syncGitHub;
export function createDashboardServer(c:Config, sync:Sync=syncGitHub){
  const sessions=sessionStore(), limitLogin=fixedWindow(8,15*60_000);
  const limitSync=fixedWindow(8,60_000);
  const deliveries=new Map<string,number>();
  let cache:{payload:Awaited<ReturnType<Sync>>;at:number}|null=null;
  let inFlight:Promise<void>|null=null, version=0, refreshAgain=false;
  let timer:ReturnType<typeof setTimeout>|null=null;
  function refresh(){
    if(c.mode==='demo')return Promise.resolve();
    if(inFlight)return inFlight;
    const epoch=version;
    inFlight=Promise.resolve().then(()=>sync({appId:c.appId,privateKey:c.privateKey,allowedInstallations:c.installations,progressMilestones:c.progressMilestones}))
      .then(payload=>{if(epoch===version)cache={payload,at:Date.now()}})
      .catch(()=>{if(epoch===version)cache=null;throw new HttpError(503,'GitHub synchronization unavailable.')})
      .finally(()=>{inFlight=null;if(refreshAgain){refreshAgain=false;void refresh().catch(()=>{})}});
    return inFlight;
  }
  function schedule(invalidate=false){
    if(invalidate){cache=null;version++;if(inFlight)refreshAgain=true}
    if(!timer)timer=setTimeout(()=>{timer=null;void refresh().catch(()=>{})},1000).unref();
  }
  const repoEvents=new Set(['issues','pull_request','workflow_run','release','milestone','repository','installation','installation_repositories']);
  async function webhook(req:IncomingMessage,res:ServerResponse){
    if(c.mode!=='live')throw new HttpError(404,'Not found.');
    const raw=await readBody(req,1024*1024);
    if(!verifySignature(raw,header(req,'x-hub-signature-256'),c.webhookSecret))throw new HttpError(401,'Invalid webhook signature.');
    const type=header(req,'x-github-event'), delivery=header(req,'x-github-delivery');
    if(type==='ping')return json(res,202,{accepted:true});
    if(!repoEvents.has(type))return json(res,202,{ignored:true});
    const data=inputObject(raw), installation=data.installation as {id?:number|string}|undefined;
    if(!installation||!c.installations.includes(String(installation.id??'')))return json(res,202,{ignored:true});
    if(!/^[a-zA-Z0-9-]{4,100}$/.test(delivery))throw new HttpError(400,'Invalid delivery identifier.');
    const now=Date.now();
    for(const [k,until] of deliveries)if(until<=now)deliveries.delete(k);
    if(deliveries.has(delivery))return json(res,202,{duplicate:true});
    if(deliveries.size>=4096)deliveries.delete(deliveries.keys().next().value!);
    deliveries.set(delivery,now+validity);
    // Permission changes must not expose the prior inventory while we reconcile.
    schedule(type==='installation'||type==='installation_repositories'||type==='repository');
    return json(res,202,{accepted:true});
  }
  async function api(req:IncomingMessage,res:ServerResponse,path:string){
    const method=req.method??'GET';
    if(path==='/api/webhooks/github'&&method==='POST')return webhook(req,res);
    const token=readSessionCookie(req.headers.cookie), authed=c.mode==='demo'||sessions.valid(token);
    if(path==='/api/session'&&method==='GET')return json(res,200,{mode:c.mode,authenticated:authed});
    if(method!=='GET'&&header(req,'origin')!==c.origin)throw new HttpError(403,'Origin not allowed.');
    if(path==='/api/login'&&method==='POST'){
      if(c.mode!=='live')return json(res,200,{authenticated:true,mode:c.mode});
      const ip=req.socket.remoteAddress??'unknown';
      if(!limitLogin(ip))throw new HttpError(429,'Too many login attempts. Try again later.');
      const payload=inputObject(await readBody(req,4096));
      if(typeof payload.passphrase!=='string'||!verifyPassword(payload.passphrase,c.ownerHash))throw new HttpError(401,'Invalid passphrase.');
      sessions.remove(token);
      res.setHeader('Set-Cookie',sessionCookie(sessions.create(),sessionTtlMs/1000));
      return json(res,200,{authenticated:true,mode:c.mode});
    }
    if(path==='/api/logout'&&method==='POST'){
      sessions.remove(token);res.setHeader('Set-Cookie',sessionCookie('',0));
      return json(res,200,{authenticated:false,mode:c.mode});
    }
    if(!authed)throw new HttpError(401,'Sign in first.');
    if(path==='/api/bootstrap'&&method==='GET'){
      if(c.mode==='demo')return json(res,200,demo);
      if(!cache||Date.now()-cache.at>validity)await refresh();
      if(!cache)throw new HttpError(503,'Refreshing repository permissions. Please retry.');
      return json(res,200,cache.payload);
    }
    if(path==='/api/sync'&&method==='POST'){
      if(c.mode==='live'){
        if(!token||!limitSync(token))throw new HttpError(429,'Please wait before synchronizing again.');
        await refresh();
      }
      return json(res,200,{mode:c.mode,synchronized:true});
    }
    throw new HttpError(404,'Not found.');
  }
  async function staticFile(req:IncomingMessage,res:ServerResponse,url:string){
    if(!['GET','HEAD'].includes(req.method??'GET'))throw new HttpError(405,'Method not allowed.');
    let path:string;
    try {path=decodeURIComponent(url)}catch{throw new HttpError(400,'Invalid URL.')}
    if(path.includes('\\')||path.includes('\0')||path.split('/').some(part=>part.startsWith('.')&&part!==''))throw new HttpError(404,'Not found.');
    const root=resolve(c.dist), file=resolve(root,path==='/'?'index.html':'.'+path);
    if(!file.startsWith(root+sep)||!assetTypes[extname(file)])throw new HttpError(404,'Not found.');
    let content:Buffer;
    try {content=await readFile(file)}catch{throw new HttpError(404,'Not found. Build the frontend with npm run build if needed.')}
    res.writeHead(200,{'Content-Type':assetTypes[extname(file)],'Content-Length':content.length});
    res.end(req.method==='HEAD'?undefined:content);
  }
  const server=createServer({requestTimeout:20_000,headersTimeout:10_000,maxHeaderSize:16384},async(req,res)=>{
    headers(res);
    if(c.mode==='live')res.setHeader('Strict-Transport-Security','max-age=31536000');
    try{
      const path=new URL(req.url??'/','http://localhost').pathname;
      if(path.startsWith('/api/'))await api(req,res,path);else await staticFile(req,res,path);
    }catch(e){
      if(!res.headersSent&&!res.destroyed)json(res,e instanceof HttpError?e.status:500,{error:e instanceof HttpError?e.message:'Unexpected server error.'});
    }
  });
  if(c.mode==='live'){
    const periodic=setInterval(()=>void refresh().catch(()=>{}),period).unref();
    server.on('close',()=>{clearInterval(periodic);if(timer)clearTimeout(timer)});
  }
  return server;
}
if(import.meta.main){
  try{
    const c=config();
    createDashboardServer(c).listen(c.port,c.host,()=>console.log(`So7obDash ${c.mode} is listening on ${c.host}:${c.port}`));
  }catch(e){console.error(e instanceof Error?e.message:'Startup failed.');process.exitCode=1}
}
