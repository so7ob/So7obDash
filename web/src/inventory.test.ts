import {strict as assert} from 'node:assert';
import test from 'node:test';
import {inventoryRequests,liveInventoryRefreshMs,observeLiveInventory} from './inventory.ts';

test('a superseded response cannot restore the previous private inventory',()=>{
 const gate=inventoryRequests();
 const old=gate.begin();
 const fresh=gate.begin();
 assert.equal(old.signal.aborted,true);
 assert.equal(gate.current(old),false);
 assert.equal(gate.current(fresh),true);
 gate.finish(old);
 assert.equal(gate.current(fresh),true);
 gate.finish(fresh);
 assert.equal(gate.pending(),false);
});

test('cancellation drops outstanding results and permits a later authorized check',()=>{
 const gate=inventoryRequests();
 const old=gate.begin();
 gate.cancel();
 assert.equal(gate.pending(),false);
 assert.equal(gate.current(old),false);
 const recovery=gate.begin();
 assert.equal(gate.current(recovery),true);
 gate.finish(recovery);
 assert.equal(gate.pending(),false);
});

test('a returning hidden tab revalidates even with a request in flight; polling skips overlap and hidden tabs',()=>{
 const document=Object.assign(new EventTarget(),{visibilityState:'visible' as DocumentVisibilityState});
 let tick:()=>void=()=>assert.fail('timer not installed');
 let cleaned=false;
 const calls:boolean[]=[];
 let pending=false;
 const stop=observeLiveInventory(document,{
  setInterval(fn,ms){assert.equal(ms,liveInventoryRefreshMs);assert.equal(typeof fn,'function');tick=fn as ()=>void;return 33;},
  clearInterval(id){assert.equal(id,33);cleaned=true;},
 },()=>pending,conceal=>calls.push(conceal));
 tick();
 pending=true;
 tick();
 document.visibilityState='hidden';
 document.dispatchEvent(new Event('visibilitychange'));
 pending=false;
 tick();
 pending=true;
 document.visibilityState='visible';
 document.dispatchEvent(new Event('visibilitychange'));
 assert.deepEqual(calls,[false,true]);
 stop();
 document.dispatchEvent(new Event('visibilitychange'));
 assert.equal(cleaned,true);
 assert.deepEqual(calls,[false,true]);
});
