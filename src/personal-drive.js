import {graphAddress,validateMicrosoftConfig,boundedDownload} from './onedrive-client.js';
export const STORAGE_SCOPES=['Files.ReadWrite.AppFolder'];
export function personalConfig(env={}){
 const clientId=String(env.VITE_MICROSOFT_CLIENT_ID||'').trim(),tenant=String(env.VITE_MICROSOFT_TENANT_ID||'').trim().toLowerCase();
 try{validateMicrosoftConfig(clientId,tenant);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(tenant))throw Error('회사 전용 Tenant ID를 등록해야 합니다.');return {configured:true,clientId,tenant,error:''};}
 catch{return {configured:false,error:'회사 Microsoft 앱 연결 준비 중입니다. 운영자가 Client ID와 회사 Tenant ID를 등록해야 사용할 수 있습니다. 개인 업무는 공용 저장소로 전송하지 않습니다.'};}
}
export async function createPersonalDrive(config,redirectUri,fetcher=fetch,loadMsal=()=>import('@azure/msal-browser')){
 const {PublicClientApplication}=await loadMsal();
 const app=new PublicClientApplication({auth:{clientId:config.clientId,authority:'https://login.microsoftonline.com/'+config.tenant,redirectUri},cache:{cacheLocation:'memoryStorage'}});await app.initialize();let account=null;
 async function token(scopes){if(!account)throw Error('회사 Microsoft 계정으로 로그인하세요.');try{return (await app.acquireTokenSilent({account,scopes})).accessToken;}catch{throw Error('인증이 만료되었거나 권한 승인이 필요합니다. 다시 로그인하거나 자료 읽기 승인을 눌러주세요.');}}
 async function request(path,options={},scopes=STORAGE_SCOPES){const response=await fetcher(graphAddress(path),{...options,headers:{...options.headers,Authorization:'Bearer '+await token(scopes)},credentials:'omit',signal:AbortSignal.timeout(60000)});if(!response.ok){const status=response.status;throw Object.assign(Error([409,412].includes(status)?'다른 창에서 먼저 저장했습니다. 새로고침 후 변경 내용을 다시 확인하세요.':status===403?'회사 계정의 접근 권한을 확인하세요.':status===507?'본인 OneDrive 용량이 부족합니다.':`Microsoft 연결 실패 (${status}). 저장 결과를 확인하고 다시 시도하세요.`),{status});}return response;}
 const api={
 async login(){const result=await app.loginPopup({scopes:STORAGE_SCOPES,prompt:'select_account'});if(result.account.tenantId!==config.tenant)throw Error('등록된 회사 계정을 사용하세요.');account=result.account;return {id:account.tenantId+':'+account.localAccountId,email:account.username,name:account.name};},
 async consent(scopes){if(!account)throw Error('먼저 로그인하세요.');const result=await app.acquireTokenPopup({account,scopes});if(result.account.homeAccountId!==account.homeAccountId)throw Error('업무보드와 동일한 Microsoft 계정으로 승인하세요.');},
 async read(path,scopes=STORAGE_SCOPES){return (await request(path,{},scopes)).json();},
 async readText(path,scopes){return (await request(path,{},scopes)).text();},
 async download(item){return new TextDecoder().decode(await boundedDownload(item['@microsoft.graph.downloadUrl'],fetcher));},
 // Immutable numbered snapshots: two writers compete for the same next name.
 // conflictBehavior=fail at final upload commit prevents lost updates.
 async createSnapshot(folderId,name,board){
  const bytes=new TextEncoder().encode(JSON.stringify(board));if(bytes.length>20*1024*1024)throw Error('업무 데이터가 20MB를 넘었습니다. 백업 후 자료를 정리하세요.');
  const session=await (await request(`me/drive/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(name)}:/createUploadSession`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item:{'@microsoft.graph.conflictBehavior':'fail',name}})})).json();
  const u=new URL(session.uploadUrl);if(u.protocol!=='https:'||u.username||u.password||!u.hostname.endsWith('.sharepoint.com'))throw Error('회사 OneDrive 업로드 주소가 아닙니다.');
  const response=await fetcher(u.href,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Range':`bytes 0-${bytes.length-1}/${bytes.length}`},body:bytes,credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(60000)});
  if(![200,201].includes(response.status))throw Object.assign(Error([409,412].includes(response.status)?'다른 창에서 먼저 저장했습니다. 새로고침 후 다시 확인하세요.':'OneDrive 저장 완료를 확인하지 못했습니다. 새로고침 후 저장 결과를 확인하세요.'),{status:response.status});return response.json();
 },
 async clear(){account=null;await app.clearCache();}
 };return api;
}
