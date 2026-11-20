import {statuses,validateTask} from './model.js';
import {validateMessage} from './conversations.js';
import {parseImport} from './assignment-import.js';
import {parseMessageResult} from './assignment-message-actions.js';
export const TABLES=['workspaces','tasks','calendar_events','sync_runs','workspace_links','workdesk_messages','calendar_overrides','task_history','file_changes','file_sync_runs','file_summaries','source_collection_results','briefing_dismissals','workdesk_item_visibility'];
export function emptyBoard(owner,name='내 업무보드') {
 return {type:'ieum.personal',version:1,owner,revision:0,tables:Object.fromEntries(TABLES.map(t=>[t,t==='workspaces'?[{id:owner,name}]:[]]))};
}
export function validateBoard(value,owner){
 if(value?.type!=='ieum.personal'||value.version!==1||value.owner!==owner||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('본인 계정의 지원되는 이음 백업이 아닙니다.');
 for(const t of TABLES){if(!Array.isArray(value.tables?.[t])||value.tables[t].some(r=>!r||typeof r!=='object'||Array.isArray(r)||(t==='workspaces'?r.id!==owner:r.workspace_id!==owner)))throw Error('업무 데이터 구조 또는 소유자가 올바르지 않습니다: '+t);}
 if(value.tables.workspaces.length!==1)throw Error('개인 공간 정보가 올바르지 않습니다.');
 for(const t of value.tables.tasks)if(typeof t.id!=='string'||!t.title||!Object.hasOwn(statuses,t.status)||!Number.isSafeInteger(t.revision))throw Error('업무 데이터가 손상되었습니다.');
 const textFields={tasks:['id','title','project','note','remaining_action','next_action','next_review_on','due_date'],workdesk_messages:['id','body','reply','task_id','event_id','created_at'],calendar_events:['id','title','start_at','end_at','note'],workspace_links:['id','label','url','description'],file_changes:['id','name','drive_id','item_id','web_url'],briefing_dismissals:['line_text','line_key']};
 for(const [table,fields]of Object.entries(textFields))for(const row of value.tables[table])for(const field of fields)if(row[field]!=null&&typeof row[field]!=='string')throw Error('백업 항목의 텍스트 형식이 올바르지 않습니다.');
 for(const task of value.tables.tasks)if(!Array.isArray(task.source_refs)||task.source_refs.some(r=>!r||typeof r.title!=='string'||(r.url!=null&&typeof r.url!=='string')||(r.context!=null&&typeof r.context!=='string')))throw Error('업무 출처 형식이 올바르지 않습니다.');
 for(const h of value.tables.task_history)if(!h.after_data||typeof h.after_data.title!=='string'||(h.after_data.note!=null&&typeof h.after_data.note!=='string'))throw Error('업무 이력 형식이 올바르지 않습니다.');
 return value;
}
export function applyOperation(board,operation,p={},now=new Date().toISOString(),id=()=>crypto.randomUUID()){
 const next=structuredClone(board),tables=next.tables,owner=next.owner;
 if(p.p_workspace&&p.p_workspace!==owner)throw Error('현재 계정의 업무공간이 아닙니다.');
 const row=(table,value)=>{const r={...value,workspace_id:owner};tables[table].push(r);return r;};
 const requireTask=key=>{const t=tables.tasks.find(t=>t.id===key);if(!t)throw Error('업무를 찾을 수 없습니다.');return t;};
 const history=(before,after)=>row('task_history',{id:id(),task_id:after.id,actor:'본인',action:before?'수정':'등록',occurred_at:now,before_data:before,after_data:structuredClone(after)});
 function saveTask(key,expected,patch){
  const t=requireTask(key);if(t.revision!==expected)throw Error('다른 창에서 업무가 변경되었습니다. 새로고침 후 다시 확인하세요.');
  if(!patch||Object.keys(patch).some(k=>!['status','note','remaining_action','next_review_on','pending_review','archived','pinned'].includes(k)))throw Error('허용되지 않은 업무 변경입니다.');
  if(patch.status&&!Object.hasOwn(statuses,patch.status))throw Error('업무 상태를 확인하세요.');
  const before=structuredClone(t);validateTask({...t,...patch});Object.assign(t,patch,{revision:t.revision+1,updated_at:now});history(before,t);return t;
 }
 let data;
 switch(operation){
 case 'save_task':data=saveTask(p.p_id,p.p_expected,p.p_patch);break;
 case 'assignment_ingest_feed':{
  const f=p.p_feed;if(!f?.batch_id)throw Error('자료 묶음 ID가 필요합니다.');
  if(tables.sync_runs.some(r=>r.batch_id===f.batch_id))return {board:next,data:{duplicate:true}};
  const items=parseImport(JSON.stringify({type:'ieum.import',version:1,tasks:f.tasks}));
  for(const item of items){const t=tables.tasks.find(t=>t.id===item.id);const before=t?structuredClone(t):null;
   if(t){const refs=[...new Map([...t.source_refs,...item.source_refs].map(r=>[JSON.stringify(r),r])).values()];Object.assign(t,item,{source_refs:refs,pending_review:true,revision:t.revision+1,updated_at:now});history(before,t);}
   else{const created=row('tasks',{...item,status:'todo',origin:'ai',note:'',remaining_action:'',next_review_on:null,archived:false,pinned:false,pending_review:false,revision:1,created_at:now,updated_at:now});history(null,created);}
  }
  data=row('sync_runs',{id:id(),batch_id:f.batch_id,generated_at:now,summary:f.summary||'',status:'success'});break;
 }
 case 'record_workdesk_message':{
  const old=tables.workdesk_messages.find(m=>m.id===p.p_id);const body=validateMessage(p.p_body);
  if(old){if(old.body!==body||(old.task_id||null)!==(p.p_task_id||null)||(old.event_id||null)!==(p.p_event_id||null))throw Error('중복 대화 ID입니다.');data=old;break;}
  if(p.p_task_id)requireTask(p.p_task_id);
  if(p.p_event_id&&!tables.calendar_events.some(e=>e.id===p.p_event_id))throw Error('일정을 찾을 수 없습니다.');
  data=row('workdesk_messages',{id:p.p_id,body,task_id:p.p_task_id||null,event_id:p.p_event_id||null,created_at:now,resolution_status:'pending',reply:null,resolved_at:null,changes:[]});break;
 }
 case 'assignment_resolve_message':{
  const m=tables.workdesk_messages.find(m=>m.id===p.p_message);if(!m||m.resolution_status!=='pending')throw Error('이미 처리했거나 없는 대화입니다.');
  const result=parseMessageResult(JSON.stringify({type:'ieum.message',message_id:m.id,reply:p.p_reply,actions:p.p_actions,clarification:p.p_clarification}),m,tables.tasks);
  for(const a of result.actions)saveTask(a.id,a.expected_revision,a.patch);
  Object.assign(m,{reply:result.reply,changes:result.actions.map(a=>({kind:'task',id:a.id})),resolved_at:now,resolution_status:result.clarification?'clarification':'applied'});data=m;break;
 }
 case 'assignment_ingest_links':{
  data={suppressed:0};for(const l of p.p_feed.links){const old=tables.workspace_links.find(r=>r.url===l.url);if(old){if(old.removed_at)data.suppressed++;continue;}row('workspace_links',{...l,id:id(),sort_order:tables.workspace_links.length,created_at:now,added_at:now,pinned_at:null,removed_at:null});}break;
 }
 case 'set_workdesk_link_pinned':case 'set_workdesk_link_removed':{
  const l=tables.workspace_links.find(r=>r.id===p.p_link);if(!l)throw Error('자료 링크를 찾을 수 없습니다.');
  if(operation.endsWith('pinned')){if(p.p_pinned&&!l.pinned_at&&tables.workspace_links.filter(r=>r.pinned_at&&!r.removed_at).length>=7)throw Error('최대 7개까지 고정할 수 있습니다.');l.pinned_at=p.p_pinned?now:null;}else{l.removed_at=p.p_removed?now:null;l.pinned_at=null;}data=l;break;
 }
 case 'set_workdesk_item_hidden':{
  let v=tables.workdesk_item_visibility.find(r=>r.kind===p.p_kind&&r.drive_id===(p.p_drive_id||'')&&r.item_id===p.p_item_id);
  if(!['file','agenda'].includes(p.p_kind))throw Error('항목 종류 오류');const source=p.p_kind==='file'?tables.file_changes.find(f=>f.drive_id===p.p_drive_id&&f.item_id===p.p_item_id):tables.calendar_events.find(e=>e.id===p.p_item_id);if(!source&&!v)throw Error('항목을 찾을 수 없습니다.');if(!v)v=row('workdesk_item_visibility',{id:id(),kind:p.p_kind,drive_id:p.p_drive_id||'',item_id:p.p_item_id,label:source.name||source.title});v.hidden_at=p.p_hidden?now:null;data=v;break;
 }
 case 'set_workdesk_briefing_hidden':{
  const line=p.p_line.trim();let v=tables.briefing_dismissals.find(r=>r.line_text===line);if(!v)v=row('briefing_dismissals',{id:id(),line_text:line,line_key:id()});v.hidden_at=p.p_hidden?now:null;data=v;break;
 }
 case 'assignment_ingest_files':{
  const f=p.p_feed;if(tables.file_sync_runs.some(r=>r.batch_id===f.batch_id)){data={duplicate:true};break;}
  for(const file of f.files){const old=tables.file_changes.find(r=>r.drive_id===file.drive_id&&r.item_id===file.item_id);if(old)Object.assign(old,file,{changed_at:now,modified_at_source:file.modified_at,change_kind:'modified'});else row('file_changes',{...file,id:id(),changed_at:now,modified_at_source:file.modified_at,change_kind:'created'});}
  data=row('file_sync_runs',{id:id(),batch_id:f.batch_id,checked_at:now,status:f.status,detail:f.detail});break;
 }
 default:throw Error('지원하지 않는 개인 저장 작업입니다: '+operation);
 }
 return {board:next,data:structuredClone(data)};
}
export function restoreBoard(input,owner){
 if(input?.type==='ieum.personal')return structuredClone(validateBoard(input,owner));
 if(input?.type!=='dahandot.cloud-backup'||input.version!==2)throw Error('지원하지 않는 백업입니다.');
 const next=emptyBoard(owner);const mapping={tasks:'tasks',history:'task_history',events:'calendar_events',calendar_overrides:'calendar_overrides',messages:'workdesk_messages',links:'workspace_links',file_changes:'file_changes',file_sync_runs:'file_sync_runs',file_summaries:'file_summaries',briefing_dismissals:'briefing_dismissals',item_visibility:'workdesk_item_visibility'};
 for(const [source,target]of Object.entries(mapping)){if(input[source]&&!Array.isArray(input[source]))throw Error('백업 목록 형식 오류');next.tables[target]=(input[source]||[]).map(r=>({...r,workspace_id:owner}));}
 return validateBoard(next,owner);
}
