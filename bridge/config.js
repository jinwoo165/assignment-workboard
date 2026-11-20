// Server-only configuration; never falls back to the operating workboard.
export const BLOCKED_PROJECT_REFS = Object.freeze(['qiwgesnpcqqnmovnpvnh','mzwuwltiyzvxalqhcrzb','fhsgwfctadeuvmcmgcvl']);
const REF = /^[a-z]{20}$/;
function exactHttps(value, name) {
  let u; try { u = new URL(value); } catch { throw Error(`${name} must be an HTTPS URL`); }
  if(u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw Error(`${name} must be an HTTPS URL without credentials/query/hash`);
  return u;
}
export function loadBridgeConfig(env) {
  if(env.ASSIGNMENT_ENVIRONMENT !== 'assignment') throw Error('ASSIGNMENT_ENVIRONMENT must be assignment');
  const projectRef = env.ASSIGNMENT_PROJECT_REF || '';
  if(!REF.test(projectRef) || BLOCKED_PROJECT_REFS.includes(projectRef)) throw Error('Assignment project reference is missing or prohibited');
  const supabaseUrl = exactHttps(env.ASSIGNMENT_SUPABASE_URL,'ASSIGNMENT_SUPABASE_URL');
  if(supabaseUrl.origin !== `https://${projectRef}.supabase.co` || supabaseUrl.pathname !== '/') throw Error('Supabase URL does not match the assignment project');
  const resource = exactHttps(env.ASSIGNMENT_MCP_URL,'ASSIGNMENT_MCP_URL');
  if(resource.pathname !== '/mcp') throw Error('ASSIGNMENT_MCP_URL must end in /mcp');
  const publishableKey = env.ASSIGNMENT_SUPABASE_PUBLISHABLE_KEY || '';
  if(!publishableKey || publishableKey.startsWith('sb_secret_')) throw Error('A publishable Supabase key is required, not a secret key');
  if(publishableKey.split('.').length===3) {
    let claims; try { claims=JSON.parse(Buffer.from(publishableKey.split('.')[1],'base64url')); } catch { throw Error('Invalid publishable key'); }
    if(claims.role!=='anon'||claims.ref!==projectRef) throw Error('Legacy key is not the assignment anon key');
  } else if(!publishableKey.startsWith('sb_publishable_')) throw Error('Unsupported publishable key');
  let clients; try { clients=JSON.parse(env.ASSIGNMENT_OAUTH_CLIENTS||'{}'); } catch { throw Error('Invalid ASSIGNMENT_OAUTH_CLIENTS JSON'); }
  if(!clients || Array.isArray(clients) || typeof clients!=='object' || !Object.keys(clients).length) throw Error('Approved OAuth client IDs are required');
  for(const [provider,id] of Object.entries(clients)) if(!['chatgpt','claude'].includes(provider)|| !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw Error('Invalid approved OAuth client');
  if(new Set(Object.values(clients)).size!==Object.values(clients).length) throw Error('Each AI provider needs a distinct OAuth client');
  return Object.freeze({projectRef,supabaseUrl:supabaseUrl.origin,issuer:`${supabaseUrl.origin}/auth/v1`,resource:resource.href,resourceOrigin:resource.origin,publishableKey,clients:Object.freeze(clients),port:Number(env.PORT||8788)});
}
