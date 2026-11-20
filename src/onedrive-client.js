export function validateMicrosoftConfig(clientId,tenant='organizations'){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId||''))throw Error('Microsoft 앱의 Application (client) ID가 필요합니다.');
 if(tenant!=='organizations'&&!/^[0-9a-f-]{36}$/i.test(tenant))throw Error('회사 Tenant ID 또는 organizations만 허용합니다.');return {clientId,tenant};
}
export function graphAddress(path){const u=new URL(path,'https://graph.microsoft.com/v1.0/');if(u.origin!=='https://graph.microsoft.com'||!u.pathname.startsWith('/v1.0/')||u.username||u.password)throw Error('허용되지 않은 Microsoft Graph 주소입니다.');return u.href;}
export async function boundedDownload(url,fetcher=fetch){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||!u.hostname.endsWith('.sharepoint.com'))throw Error('회사 OneDrive 다운로드 주소가 아닙니다.');const response=await fetcher(u.href,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('파일 다운로드 실패: '+response.status);const max=20*1024*1024;if(Number(response.headers.get('content-length'))>max)throw Error('파일당 20MB 한도입니다.');const reader=response.body.getReader(),chunks=[];let count=0;try{for(;;){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>max)throw Error('파일당 20MB 한도입니다.');chunks.push(value);}}finally{await reader.cancel();}const bytes=new Uint8Array(count);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;}
export async function createOneDriveClient(config,redirectUri){
 validateMicrosoftConfig(config.clientId,config.tenant);const {PublicClientApplication}=await import('@azure/msal-browser');
 const app=new PublicClientApplication({auth:{clientId:config.clientId,authority:'https://login.microsoftonline.com/'+config.tenant,redirectUri,navigateToLoginRequestUrl:false},cache:{cacheLocation:'memoryStorage'}});await app.initialize();let account=null;
 const scopes=['Files.Read'];
 return {
 async login(){const result=await app.loginPopup({scopes,prompt:'select_account'});account=result.account;return {name:account.name,username:account.username};},
 async read(path){if(!account)throw Error('먼저 회사 Microsoft 계정으로 로그인하세요.');let token;try{token=await app.acquireTokenSilent({scopes,account});}catch{throw Error('Microsoft 인증이 만료되었습니다. 회사 계정 로그인을 다시 눌러주세요.');}const response=await fetch(graphAddress(path),{headers:{Authorization:'Bearer '+token.accessToken},signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('OneDrive 조회 실패 ('+response.status+'). 회사 권한 또는 인증 상태를 확인하세요.');return response.json();},
 async clear(){account=null;await app.clearCache();}
 };
}
