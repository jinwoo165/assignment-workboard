# 과제용 데이터베이스 설치

운영 자료를 복사하지 않은 새 Supabase 프로젝트 전용 설치본입니다. 기존 업무보드와 코드만 같은 구조를 공유합니다. 운영 DB, 기존 저장소, 운영 배포 설정에 이 파일을 실행하지 않습니다.

## 설치

1. 새 과제 프로젝트를 만들고 프로젝트 ID·URL이 운영본과 다른지 확인합니다.
2. `node scripts/build-assignment-database.mjs`를 실행합니다.
3. 새 과제 프로젝트에 `database/assignment-install.sql` 전체를 한 번 실행합니다.
4. 설치 SQL은 `public.workspaces` 또는 `workdesk_private`가 이미 있으면 즉시 중단합니다. 전체 설치가 한 트랜잭션이므로 중간 오류는 전체 롤백합니다. 이 방어는 프로젝트 선택 확인을 대신하지 않습니다.
5. Supabase Auth에서 실제 배포 URL을 Site URL 및 허용 Redirect URL로 설정하고 이메일 확인을 유지합니다. Microsoft/Google 제공자 및 OAuth 앱 Secret은 관리자 화면에서 별도 설정합니다. 소스에는 비밀값을 넣지 않습니다.
6. 검증된 로그인 이후 브라우저가 `ensure_assignment_workspace()`를 호출하면 본인 UUID에 연결된 빈 업무공간이 한 번 생성됩니다. 회사 회원으로 가입 제한하려면 회사 IdP의 테넌트 제한 또는 검증된 서버 측 허용목록을 추가 설정해야 합니다. 현재 기본은 인증·이메일 확인된 계정별 개인 공간이며 회사 직원 여부를 자동 판정하지 않습니다.
7. 로그인한 사용자가 `assignment_environment()`를 호출해 `{environment:'assignment',schema_version:1}`를 확인합니다.

## 포함 구조

기존 업무·변경 이력·일정·수집 결과·링크·대화·일정 개인 설정·최근 파일·파일 수집·요약·수집 완료 증거·주요내용 숨김·항목 숨김 및 외부 후속 이행 원장 `workdesk_followthrough`의 구조를 보존합니다. `workdesk_followthrough`는 운영본의 읽기 전용 스키마 메타데이터로 재구성한 빈 테이블이며 현재 UI에서 직접 참조하지 않습니다. 원본 데이터, 개인 주소, 예약 작업, 외부 수집 자격증명은 포함하지 않았습니다.

## 권한

- 소유권은 `auth.uid()`와 비공개 `assignment_accounts`의 연결로 판단합니다. 사용자 수정 가능 metadata 또는 전달받은 workspace ID로 권한을 결정하지 않습니다.
- `workdesk_private.access`는 기존 호환 목적으로 유지하되 이메일 변경/재사용으로 다른 사람의 공간에 접근할 수 없습니다.
- 모든 공개 업무 테이블 RLS를 유지합니다. 익명 접근은 차단합니다.
- 원래의 수집 RPC는 service_role 전용으로 유지합니다. 새 `assignment_*` 래퍼는 인증된 개인의 업무공간만 사용합니다.
- OAuth `client_id`가 있는 토큰은 읽기에 `assignment_environment=assignment` 및 `assignment_scopes`의 `workboard:read`가 필요합니다. 쓰기는 `workboard:write`가 추가로 필요합니다. DB 트리거로 직접 RPC 호출의 쓰기 우회도 막습니다.
- 일반 웹 로그인 토큰은 기존 본인 업무 조작을 사용할 수 있습니다. 개인 OAuth 연결용 client registry 및 custom token hook 활성화는 `bridge/` 안내를 따릅니다.
- 함수의 execute 권한을 새로 노출할 때 공개 기본 EXECUTE를 취소하고 명시적으로 authenticated에만 부여했습니다.

## 개인 AI용 RPC 계약

| RPC | 입력 | 결과 |
|---|---|---|
| `ensure_assignment_workspace()` | 없음 | 본인 workspaces 행 |
| `assignment_environment()` | 없음 | 환경·스키마 버전 |
| `assignment_ingest_feed(p_feed)` | 기존 dahandot.feed JSON | added/updated/duplicate |
| `assignment_ingest_files(p_feed)` | 기존 dahandot.files JSON | 기존 파일 수집 결과 |
| `assignment_ingest_file_summaries(p_feed)` | 기존 요약 계약 JSON | 기존 요약 저장 결과 |
| `assignment_ingest_links(p_feed)` | 기존 링크 계약 JSON | 기존 링크 저장 결과 |
| `assignment_record_collection(p_report)` | 기존 수집 완료 증거 JSON | saved/status/stored |
| `assignment_resolve_message(p_message,p_reply,p_actions,p_clarification)` | 본인 메시지 ID 및 기존 actions 계약 | workdesk_messages 행 |

업무·일정·배치 식별자는 `assignment:<본인 workspace UUID>:` 접두어로 분리합니다. 이미 해당 접두어가 있으면 다시 붙이지 않습니다. collection report의 feed/file batch도 동일하게 변환합니다. 조회 결과의 ID를 기존 업무 변경 actions에 그대로 사용합니다. 수집 성공 보고는 기존 완료 증거 함수의 검증을 통과해야 하며 AI의 호출 완료만으로 성공 표시를 만들지 않습니다.

## 로컬 검증

`@electric-sql/pglite@0.3.14`로 PostgreSQL SQL·권한 동작을 검사했습니다. 테스트는 실제 Supabase를 호출하지 않습니다.

```sh
node tests/assignment-database.integration.mjs
```

별도 경로에 설치했다면 `PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite`를 지정할 수 있습니다. 실제 호스팅 로그인, Google/Microsoft 인증, 이메일 전달, 실시간 변경 수신 및 ChatGPT/Claude OAuth 연결은 배포 후 별도 검증해야 합니다.
