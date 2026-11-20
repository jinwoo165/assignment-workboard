import {escapeHTML as esc} from './model.js';
import {createOneDriveClient,validateMicrosoftConfig,boundedDownload} from './onedrive-client.js';
import {extractDocument} from './document-reader.js';
export function mountOneDriveConnect(dialog,{workspace,onImport,onSaveMetadata,clientId='',tenant='organizations',sharedClient=null}){
 const key='assignment-workboard.microsoft-config:'+workspace;let remembered={};try{remembered=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
 clientId=clientId||remembered.clientId||'';tenant=remembered.tenant||tenant;
 const redirectUri=new URL('microsoft-callback.html',location.origin+location.pathname).href;
 dialog.innerHTML=`<div class="dialog-head"><h2>OneDrive 계정 연결</h2><button class="icon-btn" data-ms-close aria-label="OneDrive 연결 닫기">×</button></div><div class="dialog-body ieum-import"><p>회사 계정으로 로그인하고 폴더에서 파일을 선택합니다. 선택한 파일만 본문을 읽고, 확인 후 분석 자료로 전달합니다.</p><details ${clientId?'':'open'}><summary>최초 연결 설정</summary><p>회사 Microsoft Entra에 이음 앱을 한 번 등록해야 합니다. SPA 리디렉션 주소와 Files.Read 위임 권한을 사용합니다. 비밀번호나 Client secret을 입력하지 마세요.</p><label>앱 Client ID<input data-ms-client value="${esc(clientId)}" autocomplete="off"></label><label>회사 Tenant ID<input data-ms-tenant value="${esc(tenant)}"></label><label>등록할 SPA 리디렉션 주소<input readonly value="${esc(redirectUri)}"></label><p class="form-note">Files.Read는 로그인한 사용자의 파일 읽기 권한입니다. 선택한 폴더만으로 권한 자체가 제한되는 것은 아닙니다. 회사 정책에 따라 관리자 승인이 필요할 수 있습니다.</p><button class="btn" data-ms-prepare>설정 저장 · 로그인 준비</button></details><button class="btn primary" data-ms-login disabled>회사 Microsoft 계정으로 로그인</button><p data-ms-account>연결 전</p><div data-ms-nav></div><div data-ms-list></div><button class="btn" data-ms-more hidden>다음 파일 목록</button><button class="btn primary" data-ms-import disabled>선택한 파일 본문 가져오기</button><p data-ms-status role="status" style="white-space:pre-wrap"></p></div>`;
 const $=s=>dialog.querySelector(s),say=t=>$('[data-ms-status]').textContent=t;let client=null,items=[],parents=[],folder='root',next='',busy=false,closed=false;
 async function close(){if(busy)return;closed=true;await client?.clear();dialog.close();} $('[data-ms-close]').onclick=close;dialog.oncancel=e=>{e.preventDefault();void close();};
 async function prepare(){try{const config=validateMicrosoftConfig($('[data-ms-client]').value.trim(),$('[data-ms-tenant]').value.trim()||'organizations');await client?.clear();client=await createOneDriveClient(config,redirectUri);localStorage.setItem(key,JSON.stringify(config));$('[data-ms-login]').disabled=false;say('로그인을 준비했습니다. Microsoft 계정으로 로그인하세요.');}catch(e){say(e.message);}}
 $('[data-ms-prepare]').onclick=prepare;
 function paint(){
 $('[data-ms-nav]').innerHTML=`<p><button class="btn" data-ms-root>최상위 폴더</button>${parents.length?'<button class="btn" data-ms-back>상위 폴더</button>':''} <span>${esc(folder==='root'?'OneDrive':parents.at(-1)?.name||'폴더')}</span></p>`;
 $('[data-ms-root]').onclick=()=>{parents=[];void list('root');};const back=$('[data-ms-back]');if(back)back.onclick=()=>{const parent=parents.pop();void list(parent.parent);};
 $('[data-ms-list]').innerHTML=items.map((item,i)=>item.folder?`<p><button class="btn" data-ms-folder="${i}">📁 ${esc(item.name)}</button></p>`:`<label><input type="checkbox" data-ms-select="${i}"> ${esc(item.name)} <small>(${Math.ceil((item.size||0)/1024)} KB)</small></label>`).join('')||'<p>이 폴더에 파일이 없습니다.</p>';
 dialog.querySelectorAll('[data-ms-folder]').forEach(b=>b.onclick=()=>{const item=items[Number(b.dataset.msFolder)];parents.push({parent:folder,name:item.name});void list(item.id);});
 $('[data-ms-more]').hidden=!next;$('[data-ms-import]').disabled=!items.some(i=>i.file);
 }
 async function list(id,more=false){if(busy)return;busy=true;say('폴더 목록을 읽고 있습니다…');try{const response=await client.read(more?next:(id==='root'?'me/drive/root/children?$top=50':'me/drive/items/'+encodeURIComponent(id)+'/children?$top=50'));if(closed)return;folder=id;items=more?[...items,...(response.value||[])]:response.value||[];next=response['@odata.nextLink']||'';paint();say(`${items.length}개 항목. 아직 파일 본문을 읽지 않았습니다.`);}catch(e){say(e.message);}finally{busy=false;}}
 $('[data-ms-login]').onclick=async()=>{if(busy)return;busy=true;try{const user=await client.login();items=[];parents=[];folder='root';$('[data-ms-account]').textContent=`연결 계정: ${user.name||''} (${user.username})`;busy=false;await list('root');}catch(e){say(e.message);}finally{busy=false;}};
 $('[data-ms-more]').onclick=()=>list(folder,true);
 $('[data-ms-import]').onclick=async()=>{
 if(busy)return;const selected=Array.from(dialog.querySelectorAll('[data-ms-select]:checked')).map(c=>items[Number(c.dataset.msSelect)]);if(!selected.length||selected.length>10){say('파일을 1~10개 선택하세요.');return;}
 busy=true;dialog.querySelectorAll('button,input').forEach(n=>n.disabled=true);const documents=[],failures=[],metadata=[];let total=0;
 try{for(const item of selected){try{say(`${item.name} 본문을 읽고 있습니다…`);if(!/\.(pdf|docx|xlsx|pptx|txt|md|csv|eml|json)$/i.test(item.name))throw Error('지원하지 않는 파일 형식');if(item.size>20*1024*1024)throw Error('파일당 20MB 한도');const full=await client.read('me/drive/items/'+encodeURIComponent(item.id));const bytes=await boundedDownload(full['@microsoft.graph.downloadUrl']);const file={name:item.name,size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer,text:async()=>new TextDecoder().decode(bytes)};const text=await extractDocument(file);total+=new TextEncoder().encode(text).length;if(total>650000)throw Error('추출 본문 합계가 650KB를 넘습니다. 나누어 가져오세요.');documents.push(`[OneDrive: ${item.name}]\n원문: ${full.webUrl}\n수정: ${full.lastModifiedDateTime}\n${text}`);metadata.push({drive_id:full.parentReference.driveId,item_id:full.id,name:full.name,web_url:full.webUrl,modified_at:full.lastModifiedDateTime,folder_path:full.parentReference.path||''});}catch(e){failures.push(item.name+': '+e.message);}}
 if(!documents.length){say('가져온 본문이 없습니다.\n'+failures.join('\n'));return;}
 const detail=`선택 ${selected.length}개 중 ${documents.length}개 본문 읽음. 폴더 전체 또는 자동 주기 수집은 아님. ${failures.join('; ')}`;
 await onSaveMetadata({type:'dahandot.files',schema_version:1,batch_id:'onedrive-'+crypto.randomUUID(),checked_at:new Date().toISOString(),status:'partial',detail,files:metadata});
 await client.clear();closed=true;dialog.close();onImport(documents.join('\n\n')+(failures.length?'\n\n[미처리 자료]\n'+failures.join('\n'):''));
 }catch(e){say('저장하지 못했습니다: '+e.message);}finally{busy=false;if(!closed)dialog.querySelectorAll('button,input').forEach(n=>n.disabled=false);}
 };
 if(sharedClient){
 dialog.querySelector('details').remove();
 client={read:path=>sharedClient.read(path,['Files.Read']),clear:async()=>{},login:async()=>{await sharedClient.consent(['Files.Read']);return {name:'현재 업무보드 계정',username:''};}};
 $('[data-ms-login]').disabled=false;$('[data-ms-login]').textContent='파일 읽기 승인 · 폴더 보기';
 }else if(clientId)void prepare();if(!dialog.open)dialog.showModal();
}
