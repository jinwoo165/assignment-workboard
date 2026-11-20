# 이음 3.0 — 각자의 OneDrive에 저장

## 변경 결과와 검증 범위

직원용 웹의 Supabase 로그인·업무 저장 경로를 제거하고 Microsoft 회사 계정 로그인과 본인 OneDrive 앱 폴더 저장으로 교체했다. GitHub는 공통 프로그램을 배포한다. 직원 업무·대화·메모·출처는 배포자의 Supabase로 전송하지 않는다. 기존 데이터베이스와 개인 업무보드는 변경하지 않았다.

코드 구현 및 모의 환경 검증 단계다. 단위·DOM 통합 테스트 188개와 빌드·운영 환경 분리 검사를 통과했다. DOM 검증에는 Microsoft 대역을 사용해 업무 등록, 메모·대화 저장, 저장 실패 후 재시도, 재접속, 로그아웃 및 A/B 계정 구분을 확인했다. 실행 환경의 Chromium 소켓 제한으로 실제 브라우저 화면 검증은 수행하지 못했다. 실제 Microsoft 앱 등록, 회사 동의 정책, 두 직원의 실계정 로그인·저장·재접속은 별도 확인해야 한다. Microsoft 설정 없이 기존 운영 링크를 덮어 배포하지 않는다.

## 운영자가 한 번 준비할 항목

1. Microsoft Entra에서 회사 테넌트 전용 SPA 앱을 등록한다. 앱 이름은 `이음`을 권장한다. 직원마다 앱을 등록하지 않는다.
2. SPA Redirect URI: `https://jinwoo165.github.io/assignment-workboard/microsoft-callback.html` (로컬 검증 주소는 별도 등록).
3. 기본 위임 권한 `Files.ReadWrite.AppFolder`를 승인한다. 응용 프로그램 권한·client secret·전체 테넌트 파일 권한은 사용하지 않는다.
4. 선택 기능용 위임 권한: OneDrive 원본 읽기 `Files.Read`, OneNote 읽기 `Notes.Read`. 화면에서 사용할 때만 추가 동의를 요청한다. 회사 정책에 따라 관리자의 승인이 필요할 수 있다.
5. 저장소 Actions 변수 `MICROSOFT_CLIENT_ID`, `MICROSOFT_TENANT_ID`에 공개 식별자를 설정한다. Tenant ID는 회사 GUID를 지정한다. 직원에게 설정값을 입력시키지 않는다.
6. 검증 후 `Deploy assignment only` 워크플로를 실행한다. 배포 전 검사에서 Microsoft 설정이 없으면 실패한다. 개발 빌드는 설정 안내 화면을 제공하며 Supabase로 되돌아가지 않는다.

## 직원 사용 흐름

링크 열기 → 회사 Microsoft 계정으로 시작 → 이음 폴더 권한 승인 → 파일·본문 가져오기 → 직접 업무 등록 또는 개인 AI의 결과 확인 → 본인 OneDrive 저장.

- 업무 원본은 기본적으로 PC/OneDrive/OneNote의 기존 위치에 남는다. 선택한 파일 전체를 자동 백업하지 않는다.
- 일반 OneDrive 문서는 ‘OneDrive 파일 가져오기’에서 읽기 승인 후 선택한다. 이 권한은 선택한 파일만으로 제한되는 권한은 아니다.
- OneNote는 별도 ‘OneNote 가져오기’에서 읽기 승인 후 페이지 텍스트를 선택한다. 첨부 파일·이미지 OCR은 포함하지 않는다.
- AI 분석은 복사·붙여넣기 방식이다. ChatGPT Plus 구독을 사이트 내 API 사용권으로 취급하지 않는다. 자동 AI·두레이 수집·기존 MCP 서버 연결은 제공하지 않는다.
- 인증 토큰과 업무 화면은 메모리에서 사용한다. 새로고침 후 다시 Microsoft 로그인 버튼을 누른다. Microsoft 로그인 세션 상태에 따라 비밀번호 재입력 없이 진행할 수 있다. 로그아웃은 이음 내 캐시를 지우며 Microsoft 전체 세션을 종료하지 않는다.

## 저장 계약

`/me/drive/special/approot`로 얻은 본인 앱 폴더(`Apps/등록한 앱 이름`)에 `board-0000000001.json`부터 저장한다. 업무, 대화, 링크, 일정, 변경 이력 및 숨김 설정을 하나의 버전으로 함께 저장한다.

기존 파일을 덮어쓰지 않고 다음 번호의 스냅샷을 생성한다. `createUploadSession`의 `@microsoft.graph.conflictBehavior: fail`로 동일 번호의 동시 생성이 충돌하면 저장 성공으로 표시하지 않는다. 실패한 변경은 입력창에 유지한다. 현재 화면의 버전과 저장소의 최신 버전이 다르면 새로고침 후 재확인한다. 저장 중 버튼 중복 실행은 막고 로컬 저장 작업은 순서대로 실행한다.

전체 스냅샷은 20MB까지 지원한다. 매 저장마다 이전 버전을 남기므로 OneDrive 사용량은 증가한다. 자동 정리·대규모 데이터용 증분 저장은 이 버전에 포함하지 않는다. 앱 폴더를 외부에서 수정·삭제하면 연결 오류로 표시하며 임의로 빈 데이터로 덮어쓰지 않는다. 회사 OneDrive 보존·관리자 정책은 적용된다.

## 백업과 이전

- 새 버전: ‘내 저장소 · 백업 복원’에서 전체 JSON 내보내기 및 복원.
- 기존 Supabase 버전: 본인이 로그인해서 ‘내 업무 백업’으로 내려받은 `dahandot.cloud-backup` v2를 새 버전에서 선택. 업무·대화·링크 수를 확인하고 본인 자료라는 확인 후 복원한다. 작업공간 식별자만 현재 계정으로 치환하며 업무 ID와 연결을 보존한다.
- 새 개인 백업은 다른 계정 소유자의 백업이면 거절한다. 기존 백업에는 Microsoft 소유자 식별이 없으므로 사용자가 본인 백업임을 확인해야 한다.
- 복원은 새로운 OneDrive 버전을 남기므로 이전 상태도 파일로 남는다. Supabase 원본 삭제는 자동 실행하지 않는다. 이전 성공 검증과 데이터 보존 결정 후 별도 처리한다.

## 실제 배포 전 완료 기준

서로 다른 회사 직원 A/B로 각자 로그인 → 업무·메모·대화 저장 → 새 브라우저에서 같은 계정으로 재접속 → 본인 기록 확인 → 다른 직원의 화면·앱 폴더에 상대 데이터가 없는지 확인. 동시에 수정했을 때 한 저장이 충돌하는지 실제 Graph에서도 확인한다. 네트워크 기록에서 Supabase 요청이 없는지 확인한다. OneDrive 및 OneNote 선택 읽기, 동의 거절, 세션 만료, 용량 부족 처리도 실계정에서 확인한다.

## 근거

- [Microsoft: OneDrive 앱 폴더와 최소 권한](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder)
- [Microsoft: 업로드 세션과 충돌 처리](https://learn.microsoft.com/en-us/graph/api/driveitem-createuploadsession?view=graph-rest-1.0)
- [Microsoft: Graph 권한](https://learn.microsoft.com/en-us/graph/permissions-reference)

구현: `src/personal-drive.js`(인증·Graph), `src/personal-store.js`(개인 저장·충돌·직렬화), `src/personal-state.js`(업무 갱신·복원), `src/personal-ui.js`(시작·백업·OneNote), `src/app.js`(기존 화면 연결).
