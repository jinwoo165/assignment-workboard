import {escapeHTML as esc} from './model.js';
export function oneDriveLink(label,url){
 label=String(label||'').trim();if(!label||label.length>200)throw Error('자료 이름을 1~200자로 입력하세요.');
 let u;try{u=new URL(url);}catch{throw Error('OneDrive 자료 링크를 확인하세요.');}
 if(u.protocol!=='https:'||u.username||u.password||!(u.hostname.endsWith('.sharepoint.com')||['onedrive.live.com','1drv.ms'].includes(u.hostname)))throw Error('OneDrive 또는 회사 SharePoint의 HTTPS 링크를 입력하세요.');
 return {label,url:u.href,description:'본인이 등록한 OneDrive 자료 링크 · 본문 자동 분석 전'};
}
export function mountOneDrive(dialog,{demo=false,files=[],onSave}){
 dialog.innerHTML=`<div class="dialog-head"><h2>OneDrive 자료</h2><button class="icon-btn" data-drive-close aria-label="OneDrive 창 닫기">×</button></div><div class="dialog-body ieum-import"><p class="assignment-badge">${demo?'발표용 · OneDrive 연결을 가정한 합성 자료':'자료 링크 등록 · 자동 조회 미설정'}</p><p>${demo?'파일 변경 → 내용 분석 → 기존 업무 연결의 흐름을 시연합니다. 실제 Microsoft 계정에 접근하지 않습니다.':'OneDrive에서 사용하는 파일·폴더의 기존 링크를 등록하면 내 업무 바로가기에 저장됩니다. 이음은 링크만으로 문서 내용을 읽거나 접근 권한을 변경하지 않습니다.'}</p>${demo?files.map(f=>`<section class="ieum-import-card"><strong>${esc(f.name)}</strong><p>${esc(f.folder_path||'')}</p><small>시연 자료 · 원본 파일 없음</small></section>`).join(''):`<a class="btn" href="https://www.microsoft365.com/" target="_blank" rel="noopener noreferrer">회사 Microsoft 365 열기 ↗</a><form data-drive-form><label>자료 이름<input name="label" maxlength="200" required></label><label>OneDrive 파일·폴더 링크<input name="url" type="url" required placeholder="https://회사.sharepoint.com/…"></label><button class="btn primary" type="submit">내 바로가기에 저장</button></form><p class="form-note">자동 목록 조회·본문 분석은 Microsoft 앱 등록 및 직원별 권한 승인이 필요한 별도 연결입니다. 현재 계정 연결이 완료된 것으로 표시하지 않습니다.</p>`}<p data-drive-feedback role="status"></p></div>`;
 let busy=false;dialog.querySelector('[data-drive-close]').onclick=()=>{if(!busy)dialog.close();};dialog.oncancel=e=>{if(busy)e.preventDefault();};
 const form=dialog.querySelector('form');if(form)form.onsubmit=async e=>{e.preventDefault();if(busy)return;const feedback=dialog.querySelector('[data-drive-feedback]');try{const values=new FormData(form),link=oneDriveLink(values.get('label'),values.get('url'));busy=true;form.querySelector('button').disabled=true;const result=await onSave(link);feedback.textContent=result||'내 업무 바로가기에 저장했습니다.';}catch(err){feedback.textContent=err.message;}finally{busy=false;form.querySelector('button').disabled=false;}};
 if(!dialog.open)dialog.showModal();
}
