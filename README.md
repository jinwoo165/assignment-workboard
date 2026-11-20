# 이음 스타터 패키지 · 전체 업무보드 v2.19.0

실제 업무보드 v2.15.1의 화면 구조와 모바일 동작을 반영한 독립 과제본입니다. 간소화된 별도 보드를 만들지 않고 기존 전체 화면을 유지합니다.

- [전체 화면 체험](https://jinwoo165.github.io/assignment-workboard/?demo=1) — 합성 시연 자료, 새로고침 시 초기화
- [본인 계정으로 사용](https://jinwoo165.github.io/assignment-workboard/)
- [교재 개념·구현 대응표](guides/COURSE-MAPPING.md)
- [반복 검증·배포 절차](workflows/cicd-ieum.md)
- [검증 기록](guides/VERIFICATION-2.19.md)

추가한 것: 세 역할의 분석 기준과 반영 전 규칙 점검, 읽음·초안 동기화, 최신 모바일 화면, 자동 검증 작업. 실제 AI 분석은 개인 AI 창에서 수행하며 결과를 가져옵니다. 독립 AI 세 개의 자동 호출을 뜻하지 않습니다.

패키지를 배포받은 직원은 자신의 환경을 설정해야 합니다. .env.example을 복사해 별도 Supabase 정보를 넣으며, Microsoft 연결은 회사 앱 등록값이 필요합니다. 개인 AI 구독만으로 인증·배포가 자동 설정되지 않습니다.

---
이하 이전 구축 기록입니다. 위 안내와 guides/의 v2.19 기록이 우선합니다.

# 이음 — 실사용 업무 흐름 2.16

[로그인 후 사용](https://jinwoo165.github.io/assignment-workboard/) · [실사용 설정](handoff/실사용설정.md)

문서 본문 읽기, 개인 AI 분석 결과 가져오기, 기존 업무 연결, 대화 요청의 상태·메모 반영을 지원합니다. OneDrive 실제 인증·파일 선택 코드를 포함하며 Microsoft 앱 등록값을 설정해야 연결할 수 있습니다. 사이트 내부 자동 AI 호출은 아직 제공하지 않습니다.

아래 발표용 시나리오는 실제 계정용과 분리되어 있습니다.

# 이음 — 과제용 배포본

현재 배포와 발표 방법은 [발표와배포](handoff/발표와배포.md)를 먼저 확인하세요.

- [실제 계정용](https://jinwoo165.github.io/assignment-workboard/)
- [발표용 시나리오](https://jinwoo165.github.io/assignment-workboard/?presentation=1)
- 발표용 AI 분석·OneDrive 조회는 합성 시나리오입니다. 실제 로그인·대화·업무 저장과 구분합니다.

---
아래는 초기 구축 기술 기록입니다. 최신 범위는 위 안내와 VERIFICATION.md의 마지막 항목이 우선합니다.

# 과제용 개인 업무보드

실제로 사용하는 업무보드 v2.14.1의 화면·업무 로직을 독립 환경으로 복제한 프로젝트입니다.
업무, 달력/이력, 대화, 통합 검색, 자료/요약, 바로가기, 숨김/복원, 수집 상태, 날씨, 진행률을 유지합니다.
개인 AI는 ChatGPT 또는 Claude를 사용하도록 연결 안내와 인증된 MCP 경로를 구성합니다.

**운영 업무보드와 연결되지 않습니다.** 설정이 없으면 운영 주소로 대체하지 않고 설정 안내를 표시합니다.

## 실행
```sh
npm ci --ignore-scripts
npm test
npm run build
npm run dev
```

- `?demo=1`: 외부 DB를 읽거나 쓰지 않는 예시 화면. 실제 로그인/저장 검증이 아닙니다.
- 일반 주소: 신규 과제용 Supabase 설정 후 실제 계정으로 사용합니다.
- `.env.example`: 신규 프로젝트 환경변수. 기존 프로젝트 연결은 거부합니다.
- `npm run check:isolation`: 운영 연결값/원격 저장소 혼입 검사.
- `npm run build:deploy`: 과제용 설정이 확인된 경우만 배포 빌드.

## 문서
- [구축현황](handoff/구축현황.md)
- [배포절차](handoff/배포절차.md)
- [기능 계승과 변경](handoff/구축현황.md#계승-기능)
- [검증 결과](VERIFICATION.md)

## 구현과 운영의 구분
이 소스 패키지가 만들어졌다고 새 Supabase/GitHub/실제 로그인/ChatGPT/Claude 연결이 완료된 것은 아닙니다.
외부 생성과 계정 설정, 실제 로그인·소유권·저장·AI 왕복 시험 결과를 VERIFICATION.md에서 확인하세요.
원본 자료 수집은 각 AI에서 직원이 허용한 연결을 통해 수행합니다. AI 구독이나 선택 버튼이 수집 권한을 부여하지 않습니다.
회사 AI 구독과 모델 API는 별도입니다. 본 연결 설계는 개인 AI의 MCP 호출을 사용하며 웹앱에서 임의 API 비용을 발생시키지 않습니다.
