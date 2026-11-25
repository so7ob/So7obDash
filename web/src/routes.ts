export const pages = ['portfolio','project','roadmap','followup','connections'] as const;
export const detailTabs = ['issues','pulls','runs','releases'] as const;
export type Page = typeof pages[number];
export type DetailTab = typeof detailTabs[number];

export type WorkspaceRoute = {
 page:Page;
 repo:string;
 tab:DetailTab;
 scope:string;
};

type RouteConnection = {id:string|number};
type RouteRepository = {id:string|number;connectionIds:readonly (string|number)[]};
const validId = (value:string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value);
const isPage = (value:string):value is Page => pages.some(p=>p===value);
const isTab = (value:string):value is DetailTab => detailTabs.some(t=>t===value);
const one = (params:URLSearchParams,name:string) => {
 const values=params.getAll(name);
 return values.length===1 ? values[0] : '';
};

/** Read only agreed query names. Do not interpret alternate or repeated values. */
export function readRoute(search:string):WorkspaceRoute {
 const params=new URLSearchParams(search);
 const wantedPage=one(params,'page');
 const page=isPage(wantedPage)?wantedPage:'portfolio';
 const wantedTab=one(params,'tab'), repo=one(params,'repo'), scope=one(params,'scope');
 return {
  page,
  repo:page==='project'&&validId(repo)?repo:'',
  tab:page==='project'&&isTab(wantedTab)?wantedTab:'issues',
  scope:validId(scope)?scope:'',
 };
}

export function routeSearch(route:WorkspaceRoute):string {
 const query=new URLSearchParams();
 if(route.page!=='portfolio'&&isPage(route.page))query.set('page',route.page);
 if(route.page==='project'){
  if(validId(route.repo))query.set('repo',route.repo);
  if(route.tab!=='issues'&&isTab(route.tab))query.set('tab',route.tab);
 }
 if(validId(route.scope))query.set('scope',route.scope);
 return query.size?'?'+query.toString():'';
}

export function belongsToScope(r:RouteRepository,scope:string):boolean {
 return !scope||r.connectionIds.some(id=>String(id)===scope);
}

/** An explicit repo can be unavailable; only a generic project route gets a default. */
export function resolveRoute(route:WorkspaceRoute,connections:readonly RouteConnection[],repositories:readonly RouteRepository[]):WorkspaceRoute {
 const canonical=readRoute(routeSearch(route));
 if(canonical.scope&&!connections.some(c=>String(c.id)===canonical.scope))canonical.scope='';
 if(canonical.page==='project'&&!canonical.repo){
  const first=repositories.find(r=>belongsToScope(r,canonical.scope)&&validId(String(r.id)));
  if(first)canonical.repo=String(first.id);
 }
 return canonical;
}

export function sameView(a:WorkspaceRoute,b:WorkspaceRoute):boolean {
 return a.page===b.page&&(a.page!=='project'||a.repo===b.repo);
}
