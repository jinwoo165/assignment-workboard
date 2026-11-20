# cicd-ieum: 재현 가능한 검증·배포 절차

이 문서는 ChatGPT/Codex에 제공할 반복 작업 절차다. Claude의 slash command 또는 설치된 Skill이라고 주장하지 않는다.

## 입력과 중단 조건
- 과제 저장소와 과제 Supabase 프로젝트를 먼저 확인한다.
- .env.local은 사용자별 별도 환경 설정이다. 커밋·ZIP 포함 금지.
- 기존 운영본 연결이 감지되거나 테스트가 실패하면 배포를 중단한다.
- DB 초기 설치는 비어 있는 별도 프로젝트에서만 database/assignment-install.sql을 실행한다. 기존 프로젝트에는 필요한 migration만 적용한다.

## 순서
1. 현재 소스를 읽고 변경 범위를 정한다. 실제 운영본은 참조만 한다.
2. npm ci
3. npm test
4. npm run build:database && npm run test:database
5. npm run check:isolation
6. 과제 환경이 설정된 상태에서 npm run build (Vite는 .env.local을 읽는다).
7. 빌드 후 npm run check:isolation
8. 소스와 docs를 함께 커밋한다. 비밀 값이 없는지 확인한다.
9. GitHub Pages main /docs 게시 결과와 배포된 version.json을 확인한다.
10. 별도 체험 화면에서 자료 등록 → 검토 → 저장 → 업무 상세/달력/테마를 확인한다. 실제 로그인은 인증된 시험 계정으로 별도 검증한다.

## 결과
커밋, 배포 버전, 테스트 결과, 확인한 화면, 미검증 항목을 기록한다.
GitHub Actions verify.yml은 자동 검증이다. 현재 Pages 배포는 이미 빌드한 docs의 게시이며 이 검증 작업이 게시를 차단하는 필수 게이트로 연결된 것은 아니다.
Cloudflare 변경은 현 범위에서 보류한다. 이전할 경우 base 경로, SPA 경로, OAuth redirect, 환경변수를 별도 검증한다.
