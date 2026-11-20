// Deterministic review gates; these are not independent LLM calls.
export const ROLE_PROMPT = `세 역할의 검토 기준을 순서대로 적용한다. 1. 자료 해석자: 원문에서 담당·기한·근거를 찾고 사실과 추정을 구분한다. 2. 업무 연결자: 기존 ID와 후속 자료를 대조하고 완료 상태·사용자 메모를 보존한다. 3. 실행 검토자: 구체적인 다음 행동과 불확실한 점을 점검한다. 이는 한 번의 분석 요청 안에서 적용하는 역할 분담이며 세 AI의 독립 실행이 아니다. 내부 사고과정 대신 최종 업무와 검증 가능한 근거만 출력한다.`;
export function reviewProposal(item,old=null,existing=[]){
 const evidence=item.source_refs?.some(r=>r.context?.trim());
 const duplicate=!old&&existing.some(t=>t.title.trim().replace(/\s+/g,'')===item.title.trim().replace(/\s+/g,''));
 return [
 {role:'자료 해석자',status:evidence?'review':'attention',text:evidence?'근거 문장이 있습니다. 원문과의 일치는 직접 확인하세요.':'근거 본문이 없습니다. 출처를 열어 확인하세요.'},
 {role:'업무 연결자',status:duplicate?'attention':'review',text:old?`기존 업무에 연결합니다. ${old.status==='done'?'완료 상태와 ':''}사용자 메모는 보존됩니다.`:duplicate?'같은 제목의 업무가 있습니다. 기존 업무 연결 여부를 확인하세요.':'새 업무로 등록합니다. 중복 여부를 확인하세요.'},
 {role:'실행 검토자',status:item.next_action?.trim()?'review':'attention',text:item.next_action?.trim()?(item.due_date?'다음 행동과 기한을 확인하세요.':'다음 행동이 있습니다. 기한은 미정으로 유지합니다.'):'다음 행동이 비어 있습니다. 실행할 내용을 보완하세요.'}
 ];
}
