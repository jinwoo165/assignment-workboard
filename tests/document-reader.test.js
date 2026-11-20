import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {zipSync,strToU8} from 'fflate';
import {officeText,readDocumentBatch,boundedUnzip} from '../src/document-reader.js';
test('real Office documents extract Korean text and worksheet values',()=>{
 assert.match(officeText(fs.readFileSync('public/examples/meeting.docx'),'docx'),/수정 견적/);
 assert.match(officeText(fs.readFileSync('public/examples/report.pptx'),'pptx'),/회의 결정/);
 const sheet=officeText(fs.readFileSync('public/examples/estimate.xlsx'),'xlsx');assert.match(sheet,/단가/);assert.match(sheet,/120/);
});
test('batch keeps good files and reports unread documents instead of pretending success',async()=>{
 const r=await readDocumentBatch([{name:'memo.txt',size:4,text:async()=>'메모'}, {name:'scan.hwp',size:4,arrayBuffer:async()=>new ArrayBuffer(4)}]);assert.equal(r.documents.length,1);assert.equal(r.issues.length,1);assert.match(r.text,/메모/);
});
test('ZIP selection expands text safely and enforces decompression budget',async()=>{
 const bytes=zipSync({'folder/note.txt':strToU8('후속 회의록')});const r=await readDocumentBatch([{name:'folder.zip',size:bytes.length,arrayBuffer:async()=>bytes.buffer}]);assert.match(r.text,/후속 회의록/);
 const huge=zipSync({'large.txt':new Uint8Array(21*1024*1024)});assert.throws(()=>boundedUnzip(huge),/한도/);
});
