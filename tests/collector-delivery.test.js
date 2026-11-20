import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCollectorDelivery,collectorContext} from '../src/collector-delivery.js';
const task={id:'t1',title:'견적 검토',source_refs:[{title:'회의록',context:'검토 요청'}]};
const feed=()=>({type:'dahandot.feed',schema_version:1,batch_id:'run1',generated_at:'2026-01-01T00:00:00Z',tasks:[structuredClone(task)],events:[],sources:[]});
test('collector keeps exact batch payload for retries',()=>{const f=feed();assert.deepEqual(parseCollectorDelivery(JSON.stringify(f)),f);});
test('raw documents, invalid identities and malformed feeds cannot be saved',()=>{
 for(const input of ['회의록',{...feed(),tasks:null},{...feed(),generated_at:'2026-01-01'},{...feed(),batch_id:''},{...feed(),tasks:[]}])assert.throws(()=>parseCollectorDelivery(typeof input==='string'?input:JSON.stringify(input)));
});
test('preserves prior evidence and refuses user-owned fields and cross-workspace IDs',()=>{
 const old={...task,id:'assignment:w:t1',origin:'ai',source_refs:[...task.source_refs,{title:'첫 요청'}]};
 assert.throws(()=>parseCollectorDelivery(JSON.stringify(feed()),[old],'w'),/출처/);
 const f=feed();f.tasks[0].source_refs=old.source_refs;assert.doesNotThrow(()=>parseCollectorDelivery(JSON.stringify(f),[old],'w'));
 for(const field of ['status','note','workspace_id','remaining_action','user_fields']){const bad=feed();bad.tasks[0][field]='changed';assert.throws(()=>parseCollectorDelivery(JSON.stringify(bad)),/개인 상태/);}
 const bad=feed();bad.tasks[0].id='assignment:other:t1';assert.throws(()=>parseCollectorDelivery(JSON.stringify(bad),[],'w'),/다른 작업공간/);
});
test('events-only delivery validates timezone, date and link',()=>{
 const f=feed();f.tasks=[];f.events=[{id:'e1',title:'회의',all_day:false,start:'2026-01-01T10:00:00+09:00',end:'2026-01-01T11:00:00+09:00'}];assert.doesNotThrow(()=>parseCollectorDelivery(JSON.stringify(f)));
 for(const patch of [{url:'javascript:alert(1)'},{end:'2025-01-01T00:00:00Z'},{start:'2026-01-01T10:00:00'},{all_day:true,start:'2026-02-30',end:'2026-03-01'}])assert.throws(()=>parseCollectorDelivery(JSON.stringify({...f,events:[{...f.events[0],...patch}]})));
});
test('collector can read current IDs, evidence and task rules without credentials',()=>{
 const context=collectorContext([{...task,status:'done',note:'메모'}],[],'w','https://example.test');
 assert.equal(context.tasks[0].status,'done');assert.deepEqual(context.tasks[0].source_refs,task.source_refs);assert.match(context.instructions,/분석 기능이 없다면/);assert.equal(context.format.type,'dahandot.feed');
});
