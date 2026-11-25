/** Supersede in-flight checks so late responses cannot reintroduce an obsolete inventory. */
export function inventoryRequests(){
 let active:AbortController|undefined;
 return {
  begin(){
   active?.abort();
   const request=new AbortController();
   active=request;
   return request;
  },
  cancel(){active?.abort();active=undefined;},
  current(request:AbortController){return active===request&&!request.signal.aborted;},
  finish(request:AbortController){if(active===request)active=undefined;},
  pending(){return active!==undefined;},
 };
}

export const liveInventoryRefreshMs=60_000;

/** Poll while visible and revalidate right away when a private tab returns. */
export function observeLiveInventory(
 doc:Pick<Document,'visibilityState'|'addEventListener'|'removeEventListener'>,
 clock:Pick<Window,'setInterval'|'clearInterval'>,
 pending:()=>boolean,
 refresh:(revalidate:boolean)=>void,
){
 const foreground=()=>{if(doc.visibilityState==='visible')refresh(true);};
 const timer=clock.setInterval(()=>{if(doc.visibilityState==='visible'&&!pending())refresh(false);},liveInventoryRefreshMs);
 doc.addEventListener('visibilitychange',foreground);
 return ()=>{clock.clearInterval(timer);doc.removeEventListener('visibilitychange',foreground);};
}
