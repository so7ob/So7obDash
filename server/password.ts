import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {passwordHash} from './security.ts';

if(!process.stdin.isTTY){console.error('Run this command in an interactive terminal.');process.exitCode=1}
else{
 const silent=new Writable({write(_chunk,_encoding,cb){cb()}});
 const ui=createInterface({input:process.stdin,output:silent,terminal:true});
 try{
  process.stderr.write('New owner passphrase (input hidden, minimum 16 characters): ');
  const a=await ui.question('');process.stderr.write('\nRepeat passphrase: ');
  const b=await ui.question('');process.stderr.write('\n');
  if(a!==b||a.length<16||Buffer.byteLength(a)>512){console.error('Passphrases did not match or were outside the length limit.');process.exitCode=1}
  else console.log('OWNER_PASSWORD_SCRYPT='+passwordHash(a));
 } finally {ui.close()}
}
