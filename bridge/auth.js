import {createRemoteJWKSet, jwtVerify} from 'jose';
export class BridgeError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
export function validateClaims(payload,config,now=Math.floor(Date.now()/1000)) {
  if(payload.iss!==config.issuer) throw new BridgeError(401,'invalid_token','Unexpected token issuer');
  if(!Number.isFinite(payload.exp)||payload.exp<=now||(payload.nbf&&payload.nbf>now+5)) throw new BridgeError(401,'invalid_token','Expired or not-yet-valid token');
  if(!(Array.isArray(payload.aud)?payload.aud:[payload.aud]).includes(config.resource)) throw new BridgeError(401,'invalid_token','Token is not intended for this MCP resource');
  if(payload.role!=='authenticated'||payload.is_anonymous===true|| !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub||'')) throw new BridgeError(401,'invalid_token','An authenticated user token is required');
  const provider=Object.keys(config.clients).find(key=>config.clients[key]===payload.client_id);
  if(!provider||payload.assignment_environment!=='assignment') throw new BridgeError(403,'access_denied','OAuth client is not enabled for this assignment');
  if(!Array.isArray(payload.assignment_scopes)||!payload.assignment_scopes.includes('workboard:read')||payload.assignment_scopes.some(x=>!['workboard:read','workboard:write'].includes(x))) throw new BridgeError(403,'insufficient_scope','Assignment access was not granted');
  return {userId:payload.sub,provider,scopes:payload.assignment_scopes,clientId:payload.client_id};
}
export function createAuthenticator(config,{fetcher=fetch,verify=jwtVerify,jwks}={}){
  const keys=jwks||createRemoteJWKSet(new URL(`${config.issuer}/.well-known/jwks.json`),{timeoutDuration:5000,cooldownDuration:30000,cacheMaxAge:300000});
  return async function authenticate(request){
    const value=request.headers.get('authorization')||'';
    if(!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)||value.length>16384) throw new BridgeError(401,'invalid_token','Sign in to the assignment workboard');
    const token=value.slice(7);let payload;
    try { ({payload}=await verify(token,keys,{issuer:config.issuer,audience:config.resource,algorithms:['ES256','RS256'],requiredClaims:['exp','iat','sub','iss','aud'],clockTolerance:5})); }
    catch { throw new BridgeError(401,'invalid_token','The access token could not be verified'); }
    const identity=validateClaims(payload,config);
    // Check the current Auth user as well as JWT validity. Never trust a body-supplied owner.
    let response;try{response=await fetcher(`${config.issuer}/user`,{headers:{apikey:config.publishableKey,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(8000),redirect:'error'});}catch{throw new BridgeError(503,'auth_unavailable','Authentication service is unavailable');}
    if(!response.ok) throw new BridgeError(401,'invalid_token','User session is no longer valid');
    const user=await response.json();
    if(user.id!==identity.userId||user.is_anonymous===true) throw new BridgeError(401,'invalid_token','User identity does not match the token');
    return {...identity,token};
  };
}
export function requireWrite(identity){if(!identity.scopes.includes('workboard:write')) throw new BridgeError(403,'insufficient_scope','Write access was not granted');}
