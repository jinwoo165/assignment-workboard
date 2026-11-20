export function utilityMenus(demo=false){return `
<section id="materialsMenu" class="utility-popover" popover aria-labelledby="materialsTitle">
 <header><h2 id="materialsTitle">자료·연결</h2><button popovertarget="materialsMenu" popovertargetaction="hide" aria-label="자료·연결 닫기">×</button></header>
 <p>내 자료를 업무에 이어 붙이세요.</p>
 <button class="utility-item" data-ai-connection><strong>내 자료 가져오기</strong><small>파일·폴더·본문에서 할 일 정리</small></button>
 <button class="utility-item" data-onedrive><strong>OneDrive 자료</strong><small>업무에 연결할 자료와 링크 관리</small></button>
 <button class="utility-item" data-ms-connect><strong>OneDrive 계정 연결</strong><small>회사 Microsoft 계정으로 연결 설정</small></button>
 <button class="utility-item" data-message-actions><strong>남긴 이야기 반영</strong><small>대기 중인 요청을 확인하고 업무에 반영</small></button>
</section>
<section id="settingsMenu" class="utility-popover" popover aria-labelledby="settingsTitle">
 <header><h2 id="settingsTitle">설정·도움말</h2><button popovertarget="settingsMenu" popovertargetaction="hide" aria-label="설정·도움말 닫기">×</button></header>
 <button class="utility-item mobile-material-entry" popovertarget="materialsMenu"><strong>자료·연결</strong><small>파일 가져오기 및 OneDrive 관리</small></button>
 <button class="utility-item" data-password><strong>비밀번호 설정</strong><small>내 계정의 로그인 정보 관리</small></button>
 <button class="utility-item" data-help><strong>사용 안내</strong><small>자료 등록, 업무 관리와 백업</small></button>
 <button class="utility-item" data-course><strong>학습 내용·구현 근거</strong><small>적용한 개념과 현재 구현 범위</small></button>
 ${demo?'<p class="utility-mode-note">체험 화면의 변경은 새로고침하면 초기화됩니다.</p>':''}
 <button class="utility-item utility-logout" data-logout><strong>로그아웃</strong></button>
</section>`;}
