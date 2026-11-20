# 검증 기록 — 2026-11-20

## 기준과 분리
운영 원본: jinwoo165/dahandot-workdesk, commit 9b7a34ae59ea87dc2704d772c6d9b62b32f96f33, v2.14.1.
원본 src 파일 중 20개는 바이트 단위로 동일하다. 기존 파일 수정은 app.js, authentication.js, config.js이며 독립 설정·인증·개인 AI 화면을 추가했다. 새 모듈은 별도로 추가했다.
운영 저장소의 로컬 참조 복제본은 git status가 비어 있다. 운영 저장소 push, 운영 DB 변경, 운영 데이터 복사는 수행하지 않았다.

## 실행한 검증
- 단위·보안 회귀검사: npm test. 최종 개수는 아래 최종 실행 결과 참조.
- PostgreSQL 실행 검증: npm run test:database. 빈 스키마 설치, 중복 설치 차단, 인증 UID 소유권, 미확인 이메일 차단, 사용자 A/B 격리, 동일 원본 ID 충돌 방지, 다른 계정 ID 악용 차단, 완료·메모 보존, revision 충돌, OAuth 읽기/쓰기 범위 확인.
- npm run build: 정적 업무보드와 OAuth 승인 화면 빌드 성공.
- npm run check:isolation: 프런트엔드·빌드·MCP 서버에서 운영 URL/키/원격 연결 혼입 없음.
- 브라우저: 미설정 화면에서 운영 연결 없이 합성 체험 진입, 기존 업무 목록, 달력·업무 이력, ChatGPT/Claude 선택 및 안내/요청문 변경, 홈 복귀 확인. 실제 원문·실제 계정 사용 아님.

## 아직 검증하지 않은 범위
- 새 Supabase 프로젝트, 실제 인증메일 수신, Microsoft/Google OAuth, 직원 도메인 제한, Realtime 수신.
- 실제 사용자 A/B 계정으로 가입→저장→로그아웃→재로그인→타인 접근 차단의 hosted end-to-end 시험.
- ChatGPT/Claude의 실제 OAuth 연결 및 토큰 hook audience 호환성, 실제 데이터 읽기/쓰기/재조회.
- 개인 AI가 회사 OneDrive/메일 원문을 읽을 수 있는지 및 회사 관리자 정책.
- 자동 주기 수집: 외부 실행기가 필요하며 이 패키지에는 무인 스케줄러를 구현하지 않았다. 기존 운영 스케줄은 복제하지 않았다.
- Docker 이미지 빌드/HTTPS 배포, 모바일 viewport별 실제 브라우저 시험.

## 출시 판단
코드·로컬 테스트·배포 구성까지 준비한 상태다. 공개 배포 완료 또는 실제 로그인·AI 연결 성공으로 해석하면 안 된다. 외부 설정 후 handoff/배포절차.md의 시험을 통과해야 운영 가능으로 판정한다.

## 최종 실행 결과
- 단위/회귀/MCP 보안 테스트: 143 / 143 통과.
- PGlite PostgreSQL 통합 검증: 33 / 33 통과 (OAuth hook SQL·허용 client·읽기/쓰기·권한 조작 차단 포함).
- Vite 빌드: 성공 (75 modules, 업무보드·OAuth 승인 화면).
- 운영 연결 혼입 검사: 44개 파일 통과.
