import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {loadBridgeConfig} from './config.js';
import {createBridgeHandler} from './handler.js';
import {createStaticHandler} from './static.js';
export function createServer(config,{staticDir,handler=createBridgeHandler(config)}={}){
 const serveStatic=createStaticHandler(staticDir);
 const server=http.createServer(async(req,res)=>{
  try{
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>262144){res.writeHead(413,{'Content-Type':'application/json'});res.end('{"error":"payload_too_large"}');return;}chunks.push(chunk);}
   // TLS is terminated by the platform; configured origin is never taken from proxy headers.
   if(!req.url.startsWith('/')||req.url.startsWith('//')){res.writeHead(400);res.end();return;}
   const request=new Request(new URL(req.url,config.resourceOrigin),{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
   const response=await serveStatic(request)||await handler(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"request_failed"}');}
 });
 server.requestTimeout=20000;server.headersTimeout=15000;return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const config=loadBridgeConfig(process.env);
 createServer(config,{staticDir:process.env.ASSIGNMENT_STATIC_DIR||undefined}).listen(config.port,'0.0.0.0',()=>console.log(`Assignment MCP listening on ${config.port}; provider connection tests pending`));
}
