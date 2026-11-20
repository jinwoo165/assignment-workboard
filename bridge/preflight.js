// Public, read-only infrastructure checks. A pass is NOT an OAuth round-trip test.
export async function checkBridge(config,{fetcher=fetch}={}) {
 const checks=[];
 async function check(name,path,options,valid){try{const response=await fetcher(config.resourceOrigin+path,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});checks.push({name,ok:await valid(response)});}catch{checks.push({name,ok:false});}}
 await check('server_health','/health',{},async r=>{const j=await r.json();return r.ok&&j.service==='assignment-workboard-mcp'&&j.environment==='assignment';});
 await check('resource_metadata','/.well-known/oauth-protected-resource/mcp',{},async r=>{const j=await r.json();return r.ok&&j.resource===config.resource&&j.authorization_servers?.includes(config.issuer);});
 await check('anonymous_access_blocked','/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})},r=>r.status===401&&r.headers.get('www-authenticate')?.includes(config.resourceOrigin+'/.well-known/oauth-protected-resource/mcp'));
 return {infrastructure_ready:checks.every(x=>x.ok),oauth_roundtrip_verified:false,checks};
}
