# v2.19.0 검증 기록

2026-11-21, 과제 환경에서 실행.

- 단위·기능 테스트: 173개 통과.
- PGlite PostgreSQL 통합 테스트: 41개 통과. 다른 소유자 접근 거부, 완료·메모 보존, 오래된 revision 충돌, 읽기 전용 OAuth의 쓰기 거부 포함.
- 운영 연결 격리 검사 통과. 운영 저장소·DB 쓰기 없음.
- 빌드 완료. GitHub Actions Verify와 Pages 배포 모두 success.
- 배포된 화면 v2.19.0 확인.
- 합성 원문 입력 → 구조화 시험 결과 → 세 역할 검토 → 체험 반영 성공. 실제 외부 모델 호출을 수행한 시험이 아님.
- 학습 내용·구현 근거 창 확인.
- 375/768/1280px 달력 화면에서 document scrollWidth가 viewport 폭과 동일함을 확인. 375px 업무 패널 열림 확인.
- Light/Dark 전환 확인. 브라우저 오류 로그 없음.
- 과제 DB에 workdesk_user_state migration 적용. RLS 활성, 정책 3개, Realtime publication 등록 확인.

미검증: 이번 변경 뒤 실제 두 기기의 동일 계정 동기화, 신규 가입 이메일 수신, 회사 Microsoft OAuth, 원격 MCP 서버 종단 연결, 대규모 부하·직원 활용 효과. 기존 로그인 성공 이력과 이번 테스트는 구분한다.
