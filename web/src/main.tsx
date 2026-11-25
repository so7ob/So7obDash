import {StrictMode, useEffect, useId, useMemo, useRef, useState} from 'react';
import type {FormEvent, KeyboardEvent, ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import './styles.css';
import {inventoryRequests,observeLiveInventory} from './inventory.ts';
import {belongsToScope, detailTabs, readRoute, resolveRoute, routeSearch, sameView} from './routes.ts';
import type {DetailTab, Page, WorkspaceRoute} from './routes.ts';

type ID = string | number;
type Connection = {id:ID;account:string;ownerType:string;status:string;lastSync?:string};
type Issue = {id:ID;number:number;title:string;state:string;stateReason?:string;url:string;updatedAt?:string};
type Pull = {id:ID;number:number;title:string;state:string;merged?:boolean;draft?:boolean;url:string;baseRef?:string};
type Run = {id:ID;name:string;status:string;conclusion?:string;branch?:string;url:string};
type Release = {id:ID;name:string;tag:string;url:string;publishedAt?:string};
type Milestone = {number:number;title:string;state:string;openIssues:number;closedIssues:number};
type Progress = {completed:number;total:number;percent:number;title:string};
type Repository = {id:ID;owner:string;name:string;fullName:string;private:boolean;defaultBranch:string;description?:string;updatedAt?:string;url:string;connectionIds:ID[];issues:Issue[];pulls:Pull[];runs:Run[];releases:Release[];milestones:Milestone[];progress:Progress|null;syncStatus?:string};
type Bootstrap = {mode:'live'|'demo';connections:Connection[];repositories:Repository[];syncErrors?:string[]};
type AttentionKind = 'issues'|'pulls'|'runs';
type Attention = {repo:Repository;kind:AttentionKind;item:Issue|Pull|Run};
const labels:Record<Page,[string,string]> = {portfolio:['▦','لوحة المشاريع'],project:['◈','تفاصيل المشروع'],roadmap:['≋','خارطة الطريق'],followup:['◉','صندوق المتابعة'],connections:['◎','الحسابات والاتصالات']};
const tabs:Record<DetailTab,string> = {issues:'المهام',pulls:'طلبات الدمج',runs:'الاختبارات',releases:'الإصدارات'};
const tabKeys = detailTabs;
const isOpen = (state:string) => state?.toLowerCase() === 'open';
const repoKey = (r:Repository) => String(r.id);
const isFailure = (r:Run) => ['failure','timed_out','action_required','startup_failure','stale'].includes(r.conclusion?.toLowerCase() ?? '');
const isPendingPull = (p:Pull) => isOpen(p.state) && !p.merged && !p.draft;
const cap = (n:number) => Number.isFinite(n) ? Math.min(100,Math.max(0,n)) : 0;
const dateLabel = (raw?:string) => {if (!raw) return 'غير متاح';const d=new Date(raw);return Number.isNaN(d.valueOf())?'غير متاح':new Intl.DateTimeFormat('ar-YE',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);};
const safeUrl = (raw?:string) => {if (!raw) return undefined;try{const u=new URL(raw);return u.protocol==='https:'&&['github.com','www.github.com'].includes(u.hostname)&&!u.username&&!u.password?u.href:undefined;}catch{return undefined;}};
const projectLink = (r:Repository) => safeUrl(r.url);
function RemoteLink({url,children,className}:{url?:string;children:ReactNode;className?:string}) {const href=safeUrl(url);return href?<a className={className} href={href} target="_blank" rel="noopener noreferrer">{children}</a>:<span className={className}>{children}</span>}
class HttpError extends Error { constructor(public status:number) {super('HTTP '+status);} }
async function api<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T> {
  const r=await fetch(path,{credentials:'same-origin',cache:'no-store',signal,...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  if(!r.ok)throw new HttpError(r.status);
  return r.status===204?undefined as T:r.json() as Promise<T>;
}
function Badge({children,tone='quiet'}:{children:ReactNode;tone?:'quiet'|'mint'|'amber'|'red'|'violet'}) {return <span className={'badge '+tone}><i aria-hidden="true"/>{children}</span>}
function Empty({children}:{children:ReactNode}){return <div className="empty">{children}</div>}
function Hero({label,title,detail,children,icon='◈'}:{label:string;title:ReactNode;detail:ReactNode;children?:ReactNode;icon?:string}){
 return <header className="hero"><div className="hero-copy"><span className="eyebrow">{label}</span><h1>{title}</h1><p>{detail}</p>{children}</div><div className="hero-decoration" aria-hidden="true"><div className="orbit one"/><div className="orbit two"/><div className="orbit three"/><div className="hero-icon">{icon}</div></div></header>
}
function Meter({p,label}:{p:Progress|null;label:string}) {
 if(!p || !(p.total>0)) return <div className="progress"><div className="progress-caption"><span>إنجاز المرحلة</span><strong>غير محسوب</strong></div><small>لا نطاق معتمد قابل للقياس</small></div>;
 const percent=cap(p.percent);
 return <div className="progress"><div className="progress-caption"><span>إنجاز المرحلة</span><strong><bdi>{percent}%</bdi></strong></div><div className="meter" role="progressbar" aria-label={label} aria-valuenow={percent}><span style={{width:percent+'%'}}/></div><small>{p.completed} من {p.total} مهمة</small></div>
}
function Metric({label,value,sub,onClick}:{label:string;value:ReactNode;sub:ReactNode;onClick?:()=>void}) {
 const content=<><small>{label}</small><strong>{value}</strong><span>{sub}</span></>;
 return onClick?<button className="metric metric-action" type="button" onClick={onClick}>{content}</button>:<div className="metric">{content}</div>
}
function RepositoryMark({repo}:{repo:Repository}){return <span className={'repo-icon repo-'+(repo.name.charCodeAt(0)%3)} aria-hidden="true">{repo.name.slice(0,1).toUpperCase()}</span>}
function repoStatus(r:Repository){const s=r.syncStatus?.toLowerCase();if(!s)return ['مزامنة غير مذكورة','quiet'] as const;if(/fail|error|stale|partial|denied/.test(s))return ['بيانات قد تكون غير مكتملة','amber'] as const;if(/syncing|loading|pending/.test(s))return ['جاري التحديث','violet'] as const;if(/synced|ready|success|complete|ok|fresh/.test(s))return ['متزامن','mint'] as const;return ['حالة غير مصنفة','quiet'] as const;}
function connectionStatus(c:Connection){const s=c.status?.toLowerCase();if(/connected|active|ready|synced|ok/.test(s)&&!/disconnected|inactive|not_connected/.test(s))return ['متاح','mint'] as const;if(/denied|failed|error|expired|disconnected|inactive|revoked|not_connected/.test(s))return ['غير متاح','amber'] as const;return [c.status||'غير معروف','quiet'] as const;}
function StatusDetails({item,kind}:{item:Issue|Pull|Run|Release;kind:DetailTab}) {
 if(kind==='issues'){
  const i=item as Issue;if(isOpen(i.state)) return <Badge tone="violet">مفتوحة</Badge>;
  if(i.stateReason?.toLowerCase()==='completed')return <Badge tone="mint">مكتملة</Badge>;
  if(i.stateReason?.toLowerCase()==='not_planned')return <Badge>لم تُخطّط</Badge>;
  if(i.stateReason?.toLowerCase()==='duplicate')return <Badge>مكررة</Badge>;
  return <Badge>مغلقة</Badge>;
 }
 if(kind==='pulls'){
  const i=item as Pull;if(i.merged||i.state?.toLowerCase()==='merged')return <Badge tone="mint">مدمج</Badge>;
  if(i.draft)return <Badge>مسودة</Badge>;
  return isOpen(i.state)?<Badge tone="violet">مفتوح</Badge>:<Badge>مغلق دون دمج</Badge>;
 }
 if(kind==='runs'){
  const i=item as Run;if(isFailure(i))return <Badge tone="red">يتطلب مراجعة</Badge>;
  if(i.conclusion?.toLowerCase()==='success')return <Badge tone="mint">ناجح</Badge>;
  if(i.conclusion?.toLowerCase()==='skipped')return <Badge>تم تخطيه</Badge>;
  if(i.conclusion?.toLowerCase()==='cancelled')return <Badge>ملغى</Badge>;
  return <Badge tone={i.status?.toLowerCase()==='completed'?'quiet':'violet'}>{i.status||'غير معروف'}</Badge>;
 }
 return <Badge tone="mint">إصدار</Badge>;
}
function WorkRow({item,kind,repo}:{item:Issue|Pull|Run|Release;kind:DetailTab;repo?:Repository}) {
 const title='title' in item?item.title:item.name || ('tag' in item?item.tag:'');
 const subtitle='number' in item ? '#'+item.number : 'tag' in item ? item.tag : (item as Run).branch??'—';
 const extra=kind==='pulls'?(item as Pull).baseRef:kind==='issues'?('updatedAt' in item&&item.updatedAt?dateLabel(item.updatedAt):''):kind==='releases'?dateLabel((item as Release).publishedAt):'';
 return <article className="work-row"><div className="row-main"><RemoteLink url={item.url} className="textlink">{title}</RemoteLink><small>{repo&&<><bdi>{repo.fullName}</bdi> · </>}<bdi>{subtitle}</bdi>{extra&&<> · <bdi>{extra}</bdi></>}</small></div><StatusDetails item={item} kind={kind}/></article>
}
function repoAttention(repo:Repository):Attention[]{
 const open=repo.pulls.filter(isPendingPull).map(item=>({repo,kind:'pulls' as const,item}));
 // Keep only latest returned run per workflow/branch; previous failures are visible in project history.
 const lastRuns=new Map<string,Run>();
 for(const r of repo.runs){const key=r.name+'|'+(r.branch??'');if(!lastRuns.has(key))lastRuns.set(key,r);}
 return [...open,...Array.from(lastRuns.values()).filter(isFailure).map(item=>({repo,kind:'runs' as const,item}))];
}
function Login({onLogin,error,busy}:{onLogin:(value:string)=>void;error:string;busy:boolean}){
 const [pass,setPass]=useState('');
 function submit(e:FormEvent){e.preventDefault();if(pass && !busy)onLogin(pass);}
 return <main className="login-wrap"><section className="panel login-panel"><div className="brand-tag"><span className="logo">س</span><div><strong>سُحُب</strong><small>So7obDash</small></div></div><h1>الدخول إلى مساحة المشاريع</h1><p className="muted">هذه مساحة خاصة. أدخل عبارة مرور مالك المنصة.</p><form onSubmit={submit}><label htmlFor="owner-password">عبارة المرور</label><input id="owner-password" type="password" autoComplete="current-password" value={pass} onChange={e=>setPass(e.target.value)} required autoFocus/><button className="primary" disabled={busy||!pass}>{busy?'جارٍ الدخول…':'تسجيل الدخول'}</button></form>{error&&<p className="error-message" role="alert">{error}</p>}</section></main>
}
function ProgressDialog({p,onClose}:{p:Progress|null;onClose:()=>void}){
 const id=useId(), ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const node=ref.current;if(node&&!node.open)node.showModal();return()=>{if(node?.open)node.close();};},[]);
 return <dialog className="panel dialog" ref={ref} aria-labelledby={id} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.currentTarget===e.target){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}>
  <div className="section-head"><h2 id={id}>كيف تُحسب النسبة؟</h2><button onClick={onClose}>إغلاق</button></div>
  <Meter p={p} label="نطاق المرحلة"/>
  <p className="muted">تُعرض النسبة من نطاق المرحلة الذي يوفره الخادم. طلبات الدمج ونتائج الاختبارات تُعرض منفصلة ولا تُحتسب مهامًا منجزة إضافية.</p>
 </dialog>
}
function App(){
 const [snapshot,setSnapshot]=useState<Bootstrap|null>(null),[unauth,setUnauth]=useState(false),[loading,setLoading]=useState(true);
 const [everLive,setEverLive]=useState(false);
 const requests=useRef(inventoryRequests());
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [requested,setRequested]=useState(()=>readRoute(window.location.search));
 const [query,setQuery]=useState(''),[mode,setMode]=useState<'cards'|'table'>('cards');
 const [measure,setMeasure]=useState(''),[followKind,setFollowKind]=useState(''),[followRepo,setFollowRepo]=useState('');
 const mainRef=useRef<HTMLElement>(null),previousRoute=useRef(requested),savedRepo=useRef('');
 const routeFocus=useRef<'main'|'history'|null>(null);
 const [help,setHelp]=useState(false);
 async function load({conceal=false}:{conceal?:boolean}={}){
  const gate=requests.current, request=gate.begin();
  if(conceal){setSnapshot(null);setLoading(true);setError('');setNotice('');setHelp(false);}
  try{
   const next=await api<Bootstrap>('/api/bootstrap',undefined,AbortSignal.any([request.signal,AbortSignal.timeout(25_000)]));
   if(!gate.current(request))return false;
   if(next.mode==='live')setEverLive(true);
   setSnapshot(next);setUnauth(false);setError('');return true;
  }catch(e){
   if(!gate.current(request))return false;
   // A failed check cannot distinguish an upstream outage from a permission change.
   setSnapshot(null);setNotice('');setHelp(false);
   if(e instanceof HttpError&&e.status===401){setUnauth(true);}
   else setError('تعذّر التحقق من بيانات المشاريع. أُخفيت البيانات السابقة حتى ينجح التحقق مجددًا.');
   return false;
  }finally{
   if(gate.current(request)){gate.finish(request);setLoading(false);}
  }
 }
 useEffect(()=>{
  const c=new AbortController(), gate=requests.current;
  void (async()=>{try{
    const session=await api<{authenticated:boolean;mode:'live'|'demo'}>('/api/session',undefined,c.signal);
    if(c.signal.aborted)return;
    if(!session.authenticated){setUnauth(true);setLoading(false);return;}
    if(session.mode==='live')setEverLive(true);
  }catch{if(c.signal.aborted)return;}
  await load();})();
  return()=>{c.abort();gate.cancel();};
 },[]);
 useEffect(()=>{
  if(!everLive||unauth||busy)return;
  return observeLiveInventory(document,window,()=>requests.current.pending(),revalidate=>{void load({conceal:revalidate});});
 },[everLive,unauth,busy]);
 async function login(passphrase:string){
   setBusy(true);setError('');
   try{await api('/api/login',{passphrase});await load();}
   catch(e){setError(e instanceof HttpError&&e.status===429?'محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.':'لم يتم تسجيل الدخول. تحقق من عبارة المرور.');}
   finally{setBusy(false);}
 }
 async function sync(){
   if(busy)return;requests.current.cancel();setBusy(true);setError('');setNotice('');
   try{await api('/api/sync',{},AbortSignal.timeout(25_000));if(await load())setNotice(snapshot?.mode==='demo'?'أُعيد تحميل البيانات التجريبية.':'اكتملت محاولة المزامنة. راجع حالات الاتصالات.');}
   catch(e){
    if(e instanceof HttpError&&e.status===401){setSnapshot(null);setUnauth(true);}
    else if(await load({conceal:everLive}))setNotice(e instanceof HttpError&&e.status===429?'انتظر قليلًا قبل إعادة المزامنة.':'لم تكتمل المزامنة اليدوية. أُعيد التحقق من البيانات المعروضة.');
   }
   finally{setBusy(false);}
 }
 async function logout(){
   requests.current.cancel();setBusy(true);setError('');
   try{await api('/api/logout',{});setSnapshot(null);setUnauth(true);setNotice('');}
   catch{setNotice('تعذّر إنهاء الجلسة. أعد المحاولة.');}
   finally{setBusy(false);}
 }
 const connections=snapshot?.connections??[], allRepos=snapshot?.repositories??[];
 const route=snapshot?resolveRoute(requested,connections,allRepos):requested;
 const {page,repo,scope,tab}=route;
 const repos=useMemo(()=>allRepos.filter(r=>belongsToScope(r,scope)),[allRepos,scope]);
 const selected=repos.find(r=>repoKey(r)===repo);
 function focusMain(){
  mainRef.current?.focus({preventScroll:true});
  window.scrollTo({top:0,behavior:'auto'});
 }
 useEffect(()=>{
  const handlePop=()=>{
   routeFocus.current='history';
   setRequested(readRoute(window.location.search));
  };
  window.addEventListener('popstate',handlePop);
  return()=>window.removeEventListener('popstate',handlePop);
 },[]);
 useEffect(()=>{
  if(!snapshot)return;
  const canonical=routeSearch(route);
  if(window.location.search!==canonical){
   window.history.replaceState(null,'',window.location.pathname+canonical);
  }
  if(!sameView(requested,route)||requested.scope!==scope||requested.tab!==tab)setRequested(route);
 },[snapshot,requested,page,repo,scope,tab]);
 useEffect(()=>{
  if(!snapshot)return;
  const previous=previousRoute.current, focus=routeFocus.current;
  previousRoute.current=route;
  if(selected)savedRepo.current=repo;
  routeFocus.current=null;
  if(scope!==previous.scope)setFollowRepo('');
  if(!sameView(previous,route)){
   setHelp(false);
   if(focus){
    if(help){requestAnimationFrame(focusMain);}else focusMain();
   }
  }else if(focus==='history'&&page==='project'&&tab!==previous.tab&&document.activeElement?.getAttribute('role')==='tab'){
   document.getElementById('detail-tab-'+tab)?.focus();
  }
 },[snapshot,requested,page,repo,scope,tab,selected,help]);
 const attention=useMemo(()=>repos.flatMap(repoAttention),[repos]);
 const portfolio=repos.filter(r=>[r.fullName,r.description??''].some(s=>s.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))&&(!measure||(measure==='tracked')===Boolean(r.progress?.total)));
 const follows=attention.filter(a=>(!followKind||a.kind===followKind)&&(!followRepo||repoKey(a.repo)===followRepo));
 const measured=repos.filter(r=>Boolean(r.progress?.total));
 function navigate(next:WorkspaceRoute,focus=false){
  const resolved=resolveRoute(next,connections,allRepos), queryString=routeSearch(resolved);
  if(queryString===window.location.search){if(focus)focusMain();return;}
  routeFocus.current=focus?'main':null;
  window.history.pushState(null,'',window.location.pathname+queryString);
  setRequested(resolved);
 }
 function go(next:Page){
  const remembered=next==='project'&&repos.some(r=>repoKey(r)===savedRepo.current)?savedRepo.current:'';
  navigate(next===page?route:{page:next,scope,repo:remembered,tab:'issues'},true);
 }
 function chooseRepo(id:string){
  if(repos.some(r=>repoKey(r)===id))navigate({...route,page:'project',repo:id,tab:'issues'},true);
 }
 function goRepo(r:Repository){chooseRepo(repoKey(r));}
 function changeScope(next:string){navigate({...route,scope:next});}
 function openConnection(next:string){navigate({page:'portfolio',scope:next,repo:'',tab:'issues'},true);}
 function chooseTab(next:DetailTab){navigate({...route,tab:next});}
 function showFollow(kind:AttentionKind){setFollowKind(kind);setFollowRepo('');go('followup');}
 function handleTabKey(e:KeyboardEvent,now:DetailTab){const idx=tabKeys.indexOf(now), d=e.key==='ArrowLeft'?1:e.key==='ArrowRight'?-1:0;if(!d&&!['Home','End'].includes(e.key))return;e.preventDefault();const i=e.key==='Home'?0:e.key==='End'?tabKeys.length-1:(idx+d+tabKeys.length)%tabKeys.length;chooseTab(tabKeys[i]);document.getElementById('detail-tab-'+tabKeys[i])?.focus();}
 if(unauth)return <Login onLogin={v=>void login(v)} busy={busy} error={error}/>;
 if(!snapshot)return <main className="login-wrap"><section className="panel login-panel"><h1>سُحُب</h1>{loading?<p role="status">جارٍ تحميل لوحة المشاريع…</p>:<><p className="error-message" role="alert">{error}</p><button onClick={()=>{setLoading(true);setError('');void load();}}>إعادة المحاولة</button></>}</section></main>;
 const isDemo=snapshot.mode==='demo';
 return <div className="app">
  <a className="skip" href="#main" onClick={e=>{e.preventDefault();focusMain();}}>انتقل للمحتوى</a>
  <aside className="sidebar"><div className="brand-tag"><span className="logo">س</span><div><strong>سُحُب</strong><small>So7obDash</small></div></div><small className="nav-title">مساحة العمل</small><nav aria-label="أقسام المنصة">{(Object.keys(labels) as Page[]).map(key=><button type="button" key={key} aria-current={key===page?'page':undefined} onClick={()=>go(key)}><span aria-hidden="true">{labels[key][0]}</span>{labels[key][1]}</button>)}</nav><footer className="side-footer"><Badge tone={isDemo?'violet':'mint'}>{isDemo?'بيانات تجريبية':'بيانات GitHub'}</Badge><small>{isDemo?'العينة غير متصلة بـGitHub.':'وضع القراءة فقط؛ لا تُجري اللوحة تغييرات على GitHub.'}</small></footer></aside>
  <div className="app-content"><header className="top"><div className="top-scope"><label htmlFor="scope">نطاق الاتصالات</label><select id="scope" value={scope} onChange={e=>changeScope(e.target.value)}><option value="">كل الحسابات والمؤسسات</option>{connections.map(c=><option key={c.id} value={String(c.id)}>{c.account}</option>)}</select></div><div className="top-actions"><span className="mobile-mode"><Badge tone={isDemo?'violet':'mint'}>{isDemo?'تجريبي':'GitHub'}</Badge></span><button className="button-quiet" disabled={busy} onClick={()=>void sync()}>{busy?'جارٍ التنفيذ…':isDemo?'↻ تحديث العينة':'↻ مزامنة'}</button>{!isDemo&&<button className="button-quiet" disabled={busy} onClick={()=>void logout()}>خروج</button>}</div></header>
  <main className="pane" id="main" ref={mainRef} tabIndex={-1}>
  {snapshot.syncErrors?.length ? <section className="warning" aria-label="مشكلات المزامنة"><strong>بعض البيانات غير متاحة.</strong><ul>{snapshot.syncErrors.map((msg,i)=><li key={i}><bdi>{msg}</bdi></li>)}</ul></section>:null}
  {notice&&<p role="status" className="notice">{notice}</p>}{error&&<p role="alert" className="warning">{error}</p>}
  {page==='portfolio'&&<>
   <Hero label="محفظة المشاريع" title="مشاريعك في مكان واحد" detail="تابع إنجاز المراحل وحالة الدمج والاختبارات دون الرجوع إلى كل مستودع على حدة."><button className="primary" onClick={()=>go('roadmap')}>استكشف خارطة الطريق ←</button></Hero>
   <div className="metrics"><Metric label="المستودعات" value={repos.length} sub="ضمن نطاق العرض"/><Metric label="مراحل قابلة للقياس" value={measured.length} sub={'من أصل '+repos.length+' مستودعًا'}/><Metric label="طلبات دمج مفتوحة" value={attention.filter(a=>a.kind==='pulls').length} sub="من دون المسودات ←" onClick={()=>showFollow('pulls')}/><Metric label="اختبارات تتطلب متابعة" value={attention.filter(a=>a.kind==='runs').length} sub="آخر تشغيل متاح لكل مسار وفرع ←" onClick={()=>showFollow('runs')}/></div>
   <div className="portfolio-head"><div><h2>المستودعات</h2><small className="muted" aria-live="polite">{portfolio.length} من {repos.length} مستودعًا</small></div><div className="filters"><input type="search" aria-label="البحث في المستودعات" placeholder="ابحث عن مستودع" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="حالة نطاق المرحلة" value={measure} onChange={e=>setMeasure(e.target.value)}><option value="">كل المراحل</option><option value="tracked">قابلة للقياس</option><option value="untracked">غير قابلة للقياس</option></select><div className="view-buttons"><button aria-pressed={mode==='cards'} onClick={()=>setMode('cards')}>بطاقات</button><button aria-pressed={mode==='table'} onClick={()=>setMode('table')}>الجدول</button></div></div></div>
   {!portfolio.length?<Empty>لا توجد مستودعات تطابق الاختيارات الحالية.</Empty>:mode==='cards'?<div className="repo-grid">{portfolio.map(r=>{
     const rs=repoStatus(r);return <article className="panel repo" key={r.id}><div className="repo-head"><RepositoryMark repo={r}/><div><button className="textbutton repo-title" onClick={()=>goRepo(r)}><bdi>{r.name}</bdi></button><div className="muted repo-owner"><bdi>{r.owner}</bdi> · {r.private?'خاص':'عام'}</div></div><Badge tone={rs[1]}>{rs[0]}</Badge></div><p className="repository-description">{r.description||'لا يوجد وصف متاح.'}</p><Meter p={r.progress} label={'إنجاز '+r.name}/><div className="repo-footer"><small>فرع افتراضي: <bdi>{r.defaultBranch}</bdi></small><button className="textbutton" onClick={()=>goRepo(r)}>عرض المشروع ←</button></div></article>
   })}</div>:<div className="panel table-wrap"><table><thead><tr><th>المستودع</th><th>المالك</th><th>إنجاز المرحلة</th><th>الفرع الافتراضي</th><th>المتابعة</th></tr></thead><tbody>{portfolio.map(r=><tr key={r.id}><td><button className="textbutton" onClick={()=>goRepo(r)}><bdi>{r.name}</bdi></button></td><td><bdi>{r.owner}</bdi> · {r.private?'خاص':'عام'}</td><td>{r.progress?.total?<bdi>{cap(r.progress.percent)}%</bdi>:'غير محسوب'}</td><td><bdi>{r.defaultBranch}</bdi></td><td>{repoAttention(r).length}</td></tr>)}</tbody></table></div>}
   <section className="panel compare"><div className="section-head"><div><h2>مقارنة إنجاز المراحل</h2><p>كل نسبة لها نطاق مستقل. لا تُجمع النسب بين المستودعات.</p></div></div>{portfolio.length?<div className="compare-grid">{portfolio.map(r=><button className="compare-line" key={r.id} onClick={()=>goRepo(r)}><bdi>{r.fullName}</bdi><Meter p={r.progress} label={r.fullName}/></button>)}</div>:<Empty>لا توجد بيانات للمقارنة في هذا العرض.</Empty>}</section>
  </>}
  {page==='project'&&(!selected?<Hero label="تفاصيل المشروع" title="المستودع غير متاح" detail="لا يظهر المستودع المطلوب ضمن نطاق الاتصال الحالي، أو لم يعد متاحًا لحسابك.">
    <div className="hero-actions"><button className="primary" onClick={()=>go('portfolio')}>عودة إلى لوحة المشاريع ←</button>{repos.length>0&&<><label className="sr-only" htmlFor="recovery-repo">اختر مستودعًا متاحًا</label><select id="recovery-repo" value="" onChange={e=>chooseRepo(e.target.value)}><option value="" disabled>اختر مستودعًا متاحًا</option>{repos.map(r=><option key={r.id} value={repoKey(r)}>{r.fullName}</option>)}</select></>}</div>
  </Hero>:<>
    <button className="textbutton back" onClick={()=>go('portfolio')}>← لوحة المشاريع</button>
    <Hero label="تفاصيل المشروع" title={<bdi>{selected.name}</bdi>} detail={<><bdi>{selected.fullName}</bdi> · {selected.private?'خاص':'عام'} · الفرع الافتراضي <bdi>{selected.defaultBranch}</bdi></>}>
      <div className="hero-actions"><label className="sr-only" htmlFor="detail-repo">اختر المستودع</label><select id="detail-repo" value={repoKey(selected)} onChange={e=>chooseRepo(e.target.value)}>{repos.map(r=><option key={r.id} value={repoKey(r)}>{r.fullName}</option>)}</select>{projectLink(selected)&&<RemoteLink url={selected.url} className="button-link">المستودع على GitHub ↗</RemoteLink>}</div>
    </Hero>
    <div className="metrics"><Metric label="إنجاز المرحلة" value={selected.progress?.total?<bdi>{cap(selected.progress.percent)}%</bdi>:'—'} sub={selected.progress?.title??'لا نطاق قابل للقياس'} onClick={()=>setHelp(true)}/><Metric label="مهام مفتوحة" value={selected.issues.filter(i=>isOpen(i.state)).length} sub="ضمن البيانات المستوردة"/><Metric label="طلبات دمج مفتوحة" value={selected.pulls.filter(p=>isOpen(p.state)).length} sub="تشمل المسودات"/><Metric label="أحدث إصدار متاح" value={<bdi>{selected.releases[0]?.tag??'—'}</bdi>} sub="النشر الفعلي غير مقاس"/></div>
    <div className="project-summary"><section className="panel"><h2>نطاق المرحلة</h2><Meter p={selected.progress} label={'إنجاز '+selected.name}/><p className="muted">{selected.progress?.title??'يلزم نطاق من GitHub لعرض نسبة قابلة للتدقيق.'}</p></section><section className="panel"><h2>التسليم</h2><div className="deliver"><div><small>الدمج</small><strong>{selected.pulls.filter(p=>p.merged||p.state?.toLowerCase()==='merged').length} طلب ظاهر مدمج</strong></div><div><small>الإصدار</small><strong><bdi>{selected.releases[0]?.tag??'غير متاح'}</bdi></strong></div><div><small>النشر</small><strong>غير مقاس</strong></div></div></section></div>
    <section className="panel detail-panel"><div className="tab-list" role="tablist" aria-label="سجل المشروع">{tabKeys.map(t=><button key={t} id={'detail-tab-'+t} role="tab" type="button" aria-selected={tab===t} aria-controls="detail-tabpanel" tabIndex={tab===t?0:-1} onKeyDown={e=>handleTabKey(e,t)} onClick={()=>chooseTab(t)}>{tabs[t]} <span>{selected[t].length}</span></button>)}</div><div id="detail-tabpanel" role="tabpanel" aria-labelledby={'detail-tab-'+tab} tabIndex={0}>{selected[tab].length?<div className="work-list">{selected[tab].map(item=><WorkRow key={item.id} item={item} kind={tab}/>)}</div>:<Empty>لا توجد عناصر متاحة لهذا التبويب في البيانات الحالية.</Empty>}</div></section>
  </>)}
  {page==='roadmap'&&<><Hero label="التخطيط والتسليم" title="خارطة الطريق" detail="استعرض مراحل GitHub المتاحة، وأين توجد مرحلة قابلة للقياس." icon="≋"/>
   <div className="roadmap-grid">{repos.length?repos.map(r=><section className="panel" key={r.id}><div className="section-head"><div><h2><bdi>{r.name}</bdi></h2><small className="muted"><bdi>{r.owner}</bdi></small></div><button className="textbutton" onClick={()=>goRepo(r)}>تفاصيل ←</button></div><Meter p={r.progress} label={r.fullName}/><h3 className="road-sub">المراحل المستوردة</h3>{r.milestones.length?<div className="work-list">{r.milestones.map(m=><article key={m.number} className="work-row"><div><strong>{m.title}</strong><small>{m.openIssues} مفتوحة · {m.closedIssues} مغلقة بحسب GitHub</small></div><Badge tone={isOpen(m.state)?'violet':'quiet'}>{isOpen(m.state)?'مفتوحة':'مغلقة'}</Badge></article>)}</div>:<Empty>لا تظهر مراحل GitHub في البيانات المتاحة.</Empty>}</section>):<Empty>لا توجد مستودعات ضمن هذا النطاق.</Empty>}</div>
  </>}
  {page==='followup'&&<><Hero label="المتابعة" title="صندوق المتابعة" detail="طلبات الدمج المفتوحة والاختبارات الأخيرة التي تستحق المراجعة عبر المستودعات." icon="◉"/><section className="panel follow-panel"><div className="section-head"><div><h2>بنود المتابعة</h2><small className="muted" aria-live="polite">{follows.length} عنصرًا</small></div><div className="filters"><select aria-label="تصفية بنوع عنصر المتابعة" value={followKind} onChange={e=>setFollowKind(e.target.value)}><option value="">كل الأنواع</option><option value="pulls">طلبات دمج مفتوحة</option><option value="runs">اختبارات تتطلب مراجعة</option></select><select aria-label="تصفية بمستودع المتابعة" value={followRepo} onChange={e=>setFollowRepo(e.target.value)}><option value="">كل المستودعات</option>{repos.map(r=><option key={r.id} value={repoKey(r)}>{r.fullName}</option>)}</select></div></div>{follows.length?<div className="work-list">{follows.map(a=><WorkRow key={repoKey(a.repo)+'-'+a.kind+'-'+a.item.id} item={a.item} kind={a.kind} repo={a.repo}/>)}</div>:<Empty>لا تظهر عناصر متابعة مطابقة في البيانات الحالية.</Empty>}</section></>}
  {page==='connections'&&<><Hero label="إدارة الاتصالات" title="الحسابات والاتصالات" detail="تختلف هوية الاتصال عن مالك المستودع. لا تُعرض الرموز أو مفاتيح الوصول في هذا القسم." icon="◎"/>
   <div className="connections-grid">{connections.length?connections.map(c=>{const rs=connectionStatus(c), owned=allRepos.filter(r=>r.connectionIds.some(id=>String(id)===String(c.id)));return <section key={c.id} className="panel connection"><div className="section-head"><div><h2><bdi>{c.account}</bdi></h2><small className="muted">{/org/i.test(c.ownerType)?'مؤسسة GitHub':/user|personal/i.test(c.ownerType)?'حساب GitHub شخصي':c.ownerType||'اتصال'}</small></div><Badge tone={rs[1]}>{rs[0]}</Badge></div><p className="muted">آخر مزامنة: {dateLabel(c.lastSync)}</p><p>{owned.length} مستودعًا متاحًا في البيانات</p>{owned.length? <ul className="connection-repos">{owned.map(r=><li key={r.id}><RemoteLink url={r.url} className="textlink"><bdi>{r.fullName}</bdi></RemoteLink><span className="muted">{r.private?'خاص':'عام'}</span></li>)}</ul>:null}<button className="button-quiet" onClick={()=>openConnection(String(c.id))}>عرض مستودعات الاتصال ←</button></section>}):<Empty>لا توجد اتصالات متاحة. تحقق من إعدادات الخادم.</Empty>}</div>
  </>}
  </main></div>
  {help&&<ProgressDialog p={selected?.progress??null} onClose={()=>setHelp(false)}/>}
 </div>
}
const mount=document.getElementById('root');
if(mount)createRoot(mount).render(<StrictMode><App/></StrictMode>);
