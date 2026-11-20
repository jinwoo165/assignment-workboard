# 과제용 개인 AI MCP 연결

구현된 것은 OAuth 보호 원격 MCP 서버와 승인 화면입니다. 실제 Supabase OAuth 토큰 발급, ChatGPT/Claude 등록, 왕복 자료 저장은 아직 검증하지 않았습니다. API 키를 넣어 ChatGPT/Claude 구독을 웹사이트 내부 챗봇 API로 쓰는 방식이 아닙니다. 사용자는 자신의 AI 화면에서 이 업무보드 도구를 사용합니다. 자료 접근은 해당 AI에서 사용자가 연결한 OneDrive 등 커넥터 권한에 달려 있습니다. 이 서버 자체는 OneDrive 다운로드·파일 원본 업로드·백그라운드 수집을 하지 않습니다.

## 서버

Node 22 이상, `jose 6.2.18`, 기존 `@supabase/supabase-js`를 사용합니다. 프로젝트 루트에서 `node bridge/server.js`로 실행합니다. 플랫폼이 TLS를 종료하고 서버의 `PORT`로 전달해야 합니다. 환경 변수는 `bridge/.env.example`을 참고합니다. 서버는 .env 파일을 자동 로드하지 않습니다. 호스팅 환경 변수 또는 Node의 `--env-file` 옵션을 사용합니다. `ASSIGNMENT_STATIC_DIR=docs`이면 빌드된 프런트엔드와 `/bridge/consent.html`도 같은 서버에서 제공합니다. SQL·환경 파일·소스는 제공하지 않습니다. GitHub Pages는 프런트엔드만 배포할 수 있으므로 별도 HTTPS MCP 서버가 필요합니다.

`ASSIGNMENT_MCP_URL`은 정확한 공개 `https://호스트/mcp` 주소입니다. `VITE_ASSIGNMENT_MCP_URL`에도 같은 값을 빌드 시 넣습니다. Supabase 프로젝트 참조와 주소는 정확하게 일치해야 하고, 알려진 기존 프로젝트 세 개는 차단됩니다. 각 도구는 DB의 과제 환경 표식을 확인한 다음 실행됩니다. 이 서버에는 service_role/secret 키가 필요하지 않습니다. 사용자 OAuth JWT를 그대로 사용자 데이터 요청에 사용하며 DB의 UID 소유권 RLS를 적용합니다.

## OAuth 설정 순서 (새 과제 프로젝트에만)

1. 과제 DB 설치 및 일반 웹 로그인 검증을 먼저 완료합니다. 사용자는 업무보드에 한 번 로그인하여 개인 workspace를 생성합니다.
2. Supabase Auth의 OAuth 2.1 Server를 활성화하고 비대칭 ES256 또는 RS256 서명 키를 사용합니다. Auth Site URL을 실제 프런트엔드 주소로, Authorization Path를 `/bridge/consent.html`로 설정합니다. 하위 경로 배포라면 Site URL/경로 조합을 실제 consent URL과 일치시킵니다.
3. ChatGPT와 Claude에 각각 다른 OAuth client를 등록합니다. 실제 클라이언트 설정 화면이 제공하는 redirect URI를 정확하게 등록합니다. 추측한 콜백 주소나 와일드카드를 쓰지 않습니다. 클라이언트가 요구하는 public/confidential 유형과 인증 방식을 사용합니다. 이 MVP는 사전 등록 UUID 허용 목록을 사용하므로 Dynamic Client Registration은 끕니다. 조직 정책 때문에 사용자 등록 메뉴가 없으면 관리자 등록이 필요합니다.
4. `bridge/oauth-token-hook.sql`을 새 과제 DB에 적용합니다. 기본 허용 목록은 비어 있습니다. 스크립트 말미 예시를 실제 UUID·MCP 주소로 채워 각 provider 행을 추가하고 `enabled=true`로 설정합니다. 쓰기 허용 시 `can_write=true`입니다. 읽기 전용은 false로 둡니다. 서버의 `ASSIGNMENT_OAUTH_CLIENTS`에도 같은 UUID를 설정합니다.
5. Supabase Auth Hooks에서 Custom Access Token Hook을 `public.assignment_access_token_hook`으로 지정합니다. 이 함수는 사용자 편집 metadata를 권한으로 사용하지 않습니다. 등록된 OAuth client에게만 `assignment_environment`, `assignment_scopes`와 MCP audience를 넣습니다. 일반 웹 로그인 토큰은 기존 audience를 유지합니다.
6. 프런트엔드를 빌드하고 Node 서버를 배포합니다. ChatGPT/Claude의 원격 MCP URL에 공개 `/mcp`를 등록하고 사용자별 OAuth 로그인·동의를 진행합니다. 승인 화면에서는 업무보드 로그인을 새 창에서 마친 후 ‘로그인 확인’을 누릅니다.

Supabase의 기본 OAuth scope는 OIDC용 `openid email`입니다. DB 쓰기 권한을 scope 문자열로 오인하지 않도록 별도 서명 클레임 `assignment_scopes`와 RLS를 사용합니다. 승인 화면은 실제 요청 앱과 계정, 조회/쓰기 가능 범위를 설명합니다. OAuth grant를 철회해도 이미 발급된 JWT가 만료 전 유효할 수 있으므로 짧은 토큰 수명을 사용하고, 긴급 중지 시 서버 허용 목록에서 client를 제거하여 재배포합니다.

## 반드시 실제 배포에서 확인할 사항

- OAuth hook의 `aud: ["authenticated", "정확한 MCP URL"]`가 현재 호스팅 Auth에서 발급되고 `/auth/v1/user` 및 PostgREST에서 받아들여지는지 확인합니다. 두 audience는 Supabase와 MCP 경계를 동시에 유지하기 위한 구성입니다. 호스팅 Auth 버전에서 배열을 허용하지 않는다면 보안 검사를 끄지 말고 Auth/resource 구성을 수정한 뒤 다시 검증해야 합니다.
- Supabase metadata discovery, PKCE S256, authorization code와 refresh token 교환을 두 AI에서 각각 확인합니다. 클라이언트 등록 방식·조직 플랜/관리자 정책은 실제 계정에 따라 다릅니다.
- 사용자 A가 자료를 등록하면 A 웹보드에 반영되는지, B가 A 행을 조회·수정할 수 없는지 확인합니다. 완료/메모를 편집한 뒤 재수집해 보존 여부를 확인합니다. 낡은 revision으로 변경을 요청하면 충돌이어야 합니다.
- OAuth 승인 거부·만료·잘못된 audience·중지한 client·read-only 쓰기 시도가 실패하는지 확인합니다. 자료 읽기 권한이 없으면 failed/partial로 기록해야 합니다.
- 플랫폼 요청 크기/시간 제한, HTTPS, 부하 제한을 설정합니다. 액세스 토큰이나 자료 본문을 프록시 로그에 남기지 않습니다.

로컬 `node --test tests/bridge.test.js`는 실제 서명 검증, 잘못된 토큰·다른 사용자 응답·workspace 경계·쓰기 범위·환경 표식·MCP 응답·정적 경로 탈출을 검사합니다. 외부 OAuth 연동 테스트를 대체하지 않습니다.

## 노출 도구

`get_workspace_status`, `get_ingestion_contracts`, `read_tasks`, `read_events`, `read_calendar_overrides`, `read_messages`, `read_files`, `read_file_summaries`, `read_source_status`, `read_history`, `read_links`, `ingest_feed`, `ingest_files`, `ingest_file_summaries`, `ingest_links`, `record_collection`, `resolve_message`. 쓰기 권한 없는 사용자에게는 쓰기 도구를 목록에서 숨기고 실행도 거부합니다. 임의 SQL/RPC, 임의 URL 다운로드, 소유자 지정은 허용하지 않습니다. Streamable HTTP는 stateless POST/JSON 응답 모드입니다. SSE 장기 스트림은 제공하지 않으며 GET은 405를 반환합니다.

## 공식 근거 (2026-11-20 확인)

- [Supabase OAuth 설정](https://supabase.com/docs/guides/auth/oauth-server/getting-started)
- [Supabase OAuth flows 및 OIDC scope](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows)
- [Supabase 토큰과 RLS](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- [Supabase access token hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
- [Supabase MCP 인증](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)
- [OpenAI OAuth 인증](https://developers.openai.com/plugins/build/auth)
- [ChatGPT MCP 및 조직 권한](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)
- [Claude remote MCP 연결](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

## 공통 서버 배포 자동화 (2026-11-20 추가)

저장소 루트의 `render.yaml`은 공통 웹/MCP 서버를 위한 Render Blueprint입니다. 파일을 추가하는 것만으로 서버를 생성하거나 요금을 결제하지 않습니다. 호스팅 계정에서 별도 배포를 시작해야 합니다. free 구성은 시험용이며 가용성·유휴 중지 정책을 확인한 뒤 운영 요금제를 결정하세요.

- `npm run build:connected`: 서버 설정을 검증하고 같은 프로젝트/연결 주소로 웹사이트를 빌드합니다. 관리자 키는 허용하지 않습니다.
- `npm run check:bridge`: 공개 HTTPS 서버의 환경 표식·MCP 메타데이터·익명 접근 차단을 검사합니다. 읽기만 수행하며 사용자 데이터/토큰은 전송하지 않습니다. 전체 OAuth 로그인 성공을 의미하지 않습니다.
- 공통 서버에서 `/microsoft-callback.html` 및 PDF worker `.mjs`를 제공하도록 정적 파일 경로를 보완했습니다.
- 서버 설정은 `bridge/.env.example`을 참고하세요. `ASSIGNMENT_OAUTH_CLIENTS`에는 실등록한 앱 ID만 넣습니다. 테스트용 ID로 배포하지 않습니다.

기존 GitHub Pages 주소는 유지됩니다. 공통 서버 주소를 직원에게 배포하려면 Supabase 로그인 리디렉션/동의 화면 주소와 Microsoft SPA 리디렉션을 새 주소에 맞게 추가하고 각각 실제 로그인 시험을 마쳐야 합니다. 기존 주소/운영 프로젝트 설정을 삭제하거나 교체하지 않습니다.

직원은 서버 주소·DB 키·앱 ID를 입력하지 않는 것이 목표입니다. 운영자가 한 번 등록한 연결을 직원이 AI 설정에서 추가하고 자신의 이음 계정으로 동의합니다. 개인 AI 계정에서 커스텀 연결 메뉴가 지원되는지 실제 계정에서 확인해야 하며, 지원되지 않으면 기존 파일/답변 가져오기를 유지합니다.

공식 배포 구성 참고: https://render.com/docs/blueprint-spec
