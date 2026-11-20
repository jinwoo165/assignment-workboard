import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewProposal,ROLE_PROMPT} from '../src/assignment-review.js';
import {importPrompt} from '../src/assignment-import.js';
test('review does not claim factual validation and flags absent evidence/action',()=>{const c=reviewProposal({title:'회신',source_refs:[{title:'원문'}]});assert.equal(c[0].status,'attention');assert.equal(c[2].status,'attention');assert.match(importPrompt(),/독립 실행이 아니다/);assert.ok(importPrompt().includes(ROLE_PROMPT));});
test('review detects duplicate titles while preserving done-task guidance',()=>{const item={title:'견적 회신',source_refs:[{context:'금요일까지 회신'}],next_action:'단가 확인 후 회신'};const old={id:'a',title:'견적회신',status:'done',note:'보존 메모'};assert.equal(reviewProposal(item,null,[old])[1].status,'attention');const snapshot=JSON.stringify(old);assert.match(reviewProposal(item,old)[1].text,/완료 상태/);assert.match(reviewProposal(item,old)[0].text,/직접 확인/);assert.equal(JSON.stringify(old),snapshot);});
