import {createClient} from '@supabase/supabase-js';
import {LOGIN_CONFIGURED,SUPABASE_URL,SUPABASE_KEY,CONFIG_ERROR} from '../src/config.js';
const el=id=>document.getElementById(id);
const authorizationId=new URL(location.href).searchParams.get('authorization_id');
let db,details;
function error(message){el('error').textContent=message;el('status').textContent='연결을 완료하지 못했습니다.';}
function redirect(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)throw Error('안전하지 않은 반환 주소입니다.');if(details){const expected=new URL(details.redirect_uri);if(u.origin!==expected.origin||u.pathname!==expected.pathname)throw Error('반환 주소가 요청과 다릅니다.');}location.assign(u.href);}
async function load(){
 el('error').textContent='';el('details').hidden=true;
 try{
  if(!LOGIN_CONFIGURED)throw Error(CONFIG_ERROR||'과제용 서버 설정이 필요합니다.');
  if(!authorizationId||authorizationId.length>200)throw Error('유효한 연결 요청이 없습니다. AI에서 연결을 다시 시작해 주세요.');
  db??=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{storageKey:'assignment-workboard.auth.v1',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  const {data:{session}}=await db.auth.getSession();
  el('login').hidden=!!session;if(!session){el('status').textContent='본인 계정 로그인이 필요합니다.';return;}
  const {data:marker,error:markerError}=await db.rpc('assignment_environment');
  if(markerError||marker?.environment!=='assignment'||marker?.schema_version!==1)throw Error('과제용 서버 확인에 실패했습니다. 연결 승인을 중단합니다.');
  const {data,error:e}=await db.auth.oauth.getAuthorizationDetails(authorizationId);if(e)throw e;
  if(data?.redirect_url){redirect(data.redirect_url);return;}
  if(!data?.client?.id||data.user.id!==session.user.id)throw Error('로그인 계정과 연결 요청을 확인해 주세요.');
  details=data;el('client').textContent=`${data.client.name} (${data.client.id})`;el('account').textContent=data.user.email;el('scope').textContent=data.scope||'없음';el('details').hidden=false;el('status').textContent='내용을 확인한 뒤 연결 여부를 선택해 주세요.';
 }catch(e){error(e.message||'연결 요청 확인 실패');}
}
async function decide(approve){
 el('approve').disabled=el('deny').disabled=true;
 try{const {data,error:e}=approve?await db.auth.oauth.approveAuthorization(authorizationId,{skipBrowserRedirect:true}):await db.auth.oauth.denyAuthorization(authorizationId,{skipBrowserRedirect:true});if(e)throw e;redirect(data.redirect_url);}
 catch(e){error(e.message||'승인 처리 실패');el('approve').disabled=el('deny').disabled=false;}
}
el('retry').onclick=load;el('approve').onclick=()=>decide(true);el('deny').onclick=()=>decide(false);load();
