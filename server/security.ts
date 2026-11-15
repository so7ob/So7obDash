import {createHmac, randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';
export const cookieName='__Host-so7ob_session';
export const sessionTtlMs=8*60*60*1000;
const format=/^[a-f0-9]{32}:[a-f0-9]{128}$/i;
export const isPasswordHash=(value:string)=>format.test(value);
export function passwordHash(password:string){
  const salt=randomBytes(16);
  return salt.toString('hex')+':'+scryptSync(password,salt,64).toString('hex');
}
export function verifyPassword(password:string,stored:string){
  if(!isPasswordHash(stored)||!password||Buffer.byteLength(password)>512)return false;
  const [salt,hash]=stored.split(':');
  return timingSafeEqual(scryptSync(password,Buffer.from(salt,'hex'),64),Buffer.from(hash,'hex'));
}
export function verifySignature(body:Buffer,hash:string,secret:string){
  if(!/^sha256=[a-f0-9]{64}$/.test(hash)||!secret)return false;
  const expected=createHmac('sha256',secret).update(body).digest();
  return timingSafeEqual(expected,Buffer.from(hash.slice(7),'hex'));
}
export function readSessionCookie(header:string|undefined){
  return header?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
}
export const sessionCookie=(token:string,maxAge:number)=>`${cookieName}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
export function sessionStore(clock=Date.now){
  const sessions=new Map<string,number>();
  return {
    create(){
      for(const [token,expires] of sessions)if(expires<=clock())sessions.delete(token);
      if(sessions.size>=32)sessions.delete(sessions.keys().next().value!);
      const token=randomBytes(32).toString('hex');sessions.set(token,clock()+sessionTtlMs);return token;
    },
    valid(token?:string){return !!token&&(sessions.get(token)??0)>clock()},
    remove(token?:string){if(token)sessions.delete(token)},
  };
}
export function fixedWindow(limit:number, periodMs:number, clock=Date.now) {
  const counts=new Map<string,{count:number,until:number}>();
  return (key:string)=>{
    const now=clock();
    for(const [k,v] of counts)if(v.until<=now)counts.delete(k);
    const found=counts.get(key);
    if(found){if(found.count>=limit)return false;found.count++;return true}
    if(counts.size>=512)return false;
    counts.set(key,{count:1,until:now+periodMs});return true;
  };
}
