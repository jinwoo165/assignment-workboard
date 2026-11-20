import test from 'node:test';
import assert from 'node:assert/strict';
import {parseImport,makeFeed,readMaterials,importPrompt} from '../src/assignment-import.js';
const item={id:'work-1',title:'견적 검토',due_date:'2026-11-25',next_action:'수정 견적 대조',source_refs:[{title:'수정 견적 메일',url:'https://example.test/mail',context:'금요일 회신 요청'}]};
const parse=tasks=>parseImport(JSON.stringify({type:'ieum.import',version:1,tasks}));
test('import validates dates, identity, evidence and unsafe URLs',()=>{
 assert.equal(parse([item])[0].title,item.title);
 for(const bad of [{...item,due_date:'2026-02-30'},{...item,id:''},{...item,source_refs:[]},{...item,source_refs:[{title:'x',url:'javascript:alert(1)'}]}])assert.throws(()=>parse([bad]));
 assert.throws(()=>parse([item,item]));assert.throws(()=>parseImport('회의록 원문'));
});
test('update connects to workspace identity and merges evidence without changing status or notes',()=>{
 const old={...item,id:'assignment:w:work-1',origin:'ai',status:'done',note:'개인 메모',source_refs:[{title:'첫 회의',context:'검토 착수'}]};
 const feed=makeFeed(parse([item]),[''],[old],'w','2026-11-20T00:00:00Z','stable');
 assert.equal(feed.tasks[0].id,old.id);assert.equal(feed.tasks[0].source_refs.length,2);assert.equal(feed.tasks[0].status,undefined);assert.equal(feed.tasks[0].note,undefined);assert.deepEqual(feed.sources,[]);assert.equal(old.status,'done');
});
test('explicit matches are checked and duplicate targets cannot overwrite one another',()=>{
 const old={...item,id:'assignment:w:old',origin:'ai'};
 assert.throws(()=>makeFeed(parse([item]),['unknown'],[old],'w'));
 assert.throws(()=>makeFeed(parse([item,{...item,id:'other'}]),[old.id,old.id],[old],'w'));
 assert.throws(()=>makeFeed(parse([item]),['skip'],[old],'w'));
 assert.throws(()=>makeFeed(parse([item]),[old.id],[{...old,origin:'manual'}],'w'));
});
test('text file import reports unsupported binary files and enforces total size',async()=>{
 assert.match(await readMaterials([{name:'note.txt',size:5,text:async()=>'hello'}]),/hello/);
 await assert.rejects(readMaterials([{name:'report.pdf',size:5}]),/지원하지 않는 파일/);
 await assert.rejects(readMaterials([{name:'big.txt',size:800000}]),/700KB/);
});
test('prompt carries existing IDs and next steps and does not imply automatic execution',()=>{const p=importPrompt([{...item,status:'done',note:'보존'}],'원문');assert.match(p,/ieum.import/);assert.match(p,/work-1/);assert.match(p,/자동 수집·자동 저장을 했다고 말하지 않는다/);assert.match(p,/원문/);});
