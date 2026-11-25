import {strict as assert} from 'node:assert';
import test from 'node:test';
import {belongsToScope,readRoute,resolveRoute,routeSearch,sameView} from './routes.ts';

const connections=[{id:'studio-demo'},{id:12}];
const repositories=[{id:101,connectionIds:['studio-demo']},{id:102,connectionIds:[12]},{id:103,connectionIds:['studio-demo',12]}];

test('project links round-trip stable repository and scope IDs and preserve the active tab',()=>{
 const query='?page=project&repo=103&tab=pulls&scope=12';
 const parsed=readRoute(query);
 assert.deepEqual(parsed,{page:'project',repo:'103',tab:'pulls',scope:'12'});
 assert.equal(routeSearch(resolveRoute(parsed,connections,repositories)),query);
 assert.equal(belongsToScope(repositories[2],'12'),true);
 assert.equal(belongsToScope(repositories[0],'12'),false);
});

test('canonicalization strips unrecognized and duplicate parameters without reflecting arbitrary values',()=>{
 assert.equal(routeSearch(readRoute('?page=project&repo=101&repo=102&tab=invalid&scope=%2Ffoo&token=example')),'?page=project');
 assert.equal(routeSearch(readRoute('?page=project&repo=%3Cimg%3E&tab=issues')),'?page=project');
 assert.equal(routeSearch(readRoute('?page=portfolio&repo=101&tab=pulls')),'');
 assert.equal(routeSearch(readRoute('?page=landings&scope=studio-demo')),'?scope=studio-demo');
});

test('only a generic project route defaults to an accessible repository inside the selected scope',()=>{
 assert.equal(resolveRoute(readRoute('?page=project&scope=12'),connections,repositories).repo,'102');
 assert.equal(resolveRoute(readRoute('?page=project&scope=12'),connections,[]).repo,'');
 assert.equal(resolveRoute(readRoute('?page=project&repo=101&scope=12'),connections,repositories).repo,'101');
 assert.equal(resolveRoute(readRoute('?page=project&repo=999'),connections,repositories).repo,'999');
});

test('page and repository changes affect workspace focus; tab and account changes do not change the view identity',()=>{
 const source=readRoute('?page=project&repo=101');
 assert.equal(sameView(source,readRoute('?page=project&repo=101&tab=runs&scope=12')),true);
 assert.equal(sameView(source,readRoute('?page=project&repo=103')),false);
 assert.equal(sameView(source,readRoute('?page=connections')),false);
});
