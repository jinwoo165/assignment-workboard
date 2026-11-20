import {realpath,readFile} from 'node:fs/promises';
import path from 'node:path';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2'};
export function createStaticHandler(staticDir){
 return async request=>{
  if(!staticDir||!['GET','HEAD'].includes(request.method))return null;
  const u=new URL(request.url);let name;try{name=decodeURIComponent(u.pathname);}catch{return null;}
  if(name.includes('\\')||name.includes('\0')||name.split('/').some(s=>s==='..'||s.startsWith('.')))return null;
  if(name==='/')name='/index.html';
  const fixed=['/index.html','/bridge/consent.html','/icon.svg','/manifest.webmanifest','/version.json'];
  if(!fixed.includes(name)&&!/^\/(assets|images)\/[a-zA-Z0-9_./-]+$/.test(name))return null;
  const type=MIME[path.extname(name)];if(!type)return null;
  try{const root=await realpath(staticDir);const file=await realpath(path.join(root,name));if(!file.startsWith(root+path.sep))return null;const bytes=await readFile(file);return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-cache','Content-Security-Policy':"frame-ancestors 'none'",'X-Frame-Options':'DENY'}});}catch{return null;}
 };
}
