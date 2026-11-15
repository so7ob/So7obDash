import {readFileSync} from 'node:fs';
import {createPrivateKey} from 'node:crypto';
import {isPasswordHash} from './security.ts';

export type Config={mode:'demo'|'live';host:string;port:number;origin:string;ownerHash:string;appId:string;privateKey:string;installations:string[];webhookSecret:string;dist:string;progressMilestones:Readonly<Record<string,number>>};
export function config(env:NodeJS.ProcessEnv=process.env):Config{
 const mode=env.SO7OB_MODE;
 if(mode!=='demo'&&mode!=='live')throw Error('Set SO7OB_MODE explicitly to demo or live.');
 const host=env.HOST??'127.0.0.1';const port=Number(env.PORT??3086);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT.');
 const dist=env.DIST_DIR??'dist';
 const progressMilestones:Record<string,number>={};
 for(const entry of (env.GITHUB_PROGRESS_MILESTONES??'').split(',').map(s=>s.trim()).filter(Boolean)){
   const m=/^(\d+):(\d+)$/.exec(entry), milestone=Number(m?.[2]);
   if(!m||!Number.isSafeInteger(milestone)||milestone<1||progressMilestones[m[1]])throw Error('GITHUB_PROGRESS_MILESTONES must contain unique repositoryID:milestoneNumber pairs.');
   progressMilestones[m[1]]=milestone;
 }
 if(mode==='demo'){
   if(!['127.0.0.1','::1','localhost'].includes(host))throw Error('Demo mode binds only to loopback.');
   const fallback=`http://${host.includes(':')?'['+host+']':host}:${port}`;
   return {mode,host,port,origin:env.PUBLIC_ORIGIN??fallback,ownerHash:'',appId:'',privateKey:'',installations:[],webhookSecret:'',dist,progressMilestones};
 }
 const origin=env.PUBLIC_ORIGIN??'';
 let parsed:URL;
 try{parsed=new URL(origin)}catch{throw Error('Set PUBLIC_ORIGIN to the exact HTTPS origin.')}
 if(parsed.protocol!=='https:'||parsed.origin!==origin)throw Error('Set PUBLIC_ORIGIN to the exact HTTPS origin, no trailing slash.');
 const ownerHash=env.OWNER_PASSWORD_SCRYPT??'';
 if(!isPasswordHash(ownerHash))throw Error('Set a valid OWNER_PASSWORD_SCRYPT.');
 const appId=env.GITHUB_APP_ID??'';
 const installations=[...new Set((env.GITHUB_INSTALLATION_IDS??'').split(',').map(s=>s.trim()).filter(Boolean))];
 if(!/^\d+$/.test(appId)||!installations.length||installations.some(s=>!/^\d+$/.test(s)))throw Error('Configure a GitHub App ID and explicit installation IDs.');
 const webhookSecret=env.GITHUB_WEBHOOK_SECRET??'';
 if(webhookSecret.length<32)throw Error('Use at least 32 characters for GITHUB_WEBHOOK_SECRET.');
 const path=env.GITHUB_PRIVATE_KEY_FILE;
 if(!path)throw Error('Set GITHUB_PRIVATE_KEY_FILE.');
 const privateKey=readFileSync(path,'utf8');
 if(createPrivateKey(privateKey).asymmetricKeyType!=='rsa')throw Error('GitHub App signing key must be RSA.');
 return {mode,host,port,origin,ownerHash,appId,installations,privateKey,webhookSecret,dist,progressMilestones};
}
