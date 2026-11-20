import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadBridgeConfig} from '../bridge/config.js';
import {createServer} from '../bridge/server.js';
import {checkBridge} from '../bridge/preflight.js';
const config=loadBridgeConfig({ASSIGNMENT_ENVIRONMENT:'assignment',ASSIGNMENT_PROJECT_REF:'abcdefghijklmnopqrst',ASSIGNMENT_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',ASSIGNMENT_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',ASSIGNMENT_MCP_URL:'https://ieum.example/mcp',ASSIGNMENT_OAUTH_CLIENTS:JSON.stringify({chatgpt:'22222222-2222-4222-8222-222222222222'})});
test('real HTTP server passes public checks while refusing anonymous tool access',async()=>{
 const server=createServer(config);server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const result=await checkBridge(config,{fetcher:(url,options)=>fetch('http://127.0.0.1:'+server.address().port+new URL(url).pathname,options)});assert.equal(result.infrastructure_ready,true);assert.equal(result.oauth_roundtrip_verified,false);assert.equal(result.checks.length,3);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('preflight cannot call unprotected or wrong-environment servers ready',async()=>{
 for(const fetcher of [async()=>new Response(JSON.stringify({service:'other',environment:'production'})),async()=>{throw Error('offline');}]){const result=await checkBridge(config,{fetcher});assert.equal(result.infrastructure_ready,false);assert.equal(result.oauth_roundtrip_verified,false);}
});
test('combined hosting serves PDF worker and Microsoft callback but no source or secrets',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ieum-host-'));await mkdir(path.join(root,'assets'));await writeFile(path.join(root,'assets','worker.mjs'),'worker');await writeFile(path.join(root,'microsoft-callback.html'),'callback');await writeFile(path.join(root,'.env'),'private');const server=createServer(config,{staticDir:root});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const base='http://127.0.0.1:'+server.address().port;const worker=await fetch(base+'/assets/worker.mjs');assert.match(worker.headers.get('content-type'),/javascript/);assert.equal(await worker.text(),'worker');assert.equal(await(await fetch(base+'/microsoft-callback.html')).text(),'callback');assert.equal((await fetch(base+'/.env')).status,404);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
