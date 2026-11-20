import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM,VirtualConsole} from 'jsdom';

// DOM integration with a simulated Microsoft drive; not a real browser/account test.
const bundle=await build({entryPoints:['src/app.js'],bundle:true,write:false,format:'iife',define:{'import.meta.env':'{}'},loader:{'.css':'empty','.webp':'dataurl'},plugins:[{name:'test-microsoft',setup(b){
 b.onResolve({filter:/personal-drive\.js$/},()=>({path:'personal-drive',namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const personalConfig=()=>({configured:window.testConfigured});export const createPersonalDrive=async()=>window.testDrive;`}));
 b.onResolve({filter:/\?url$/},()=>({path:'url',namespace:'asset'}));b.onLoad({filter:/.*/,namespace:'asset'},()=>({contents:'export default "worker.js"'}));
}}]});
const code=bundle.outputFiles[0].text;
function fakeDrive(){const files=new Map();return {files,fail:false,user:'a',async login(){return {id:'tenant:'+this.user,email:this.user+'@example.invalid',name:'직원 '+this.user};},async read(path){const own=[...files.values()].filter(f=>f.owner===this.user);if(path==='me/drive/special/approot')return {id:'folder-'+this.user};if(path.includes('/children'))return {value:own.map(f=>({id:f.id,name:f.name,eTag:f.eTag,file:{}}))};const f=own.find(f=>path.endsWith('/'+f.id));if(!f)throw Error('not found');return f;},async download(f){return JSON.stringify(f.board);},async createSnapshot(folder,name,board){if(this.fail)throw Error('테스트 저장 실패');const key=this.user+name;if(files.has(key))throw Error('conflict');const f={id:key,name,eTag:key,owner:this.user,board:structuredClone(board)};files.set(key,f);return f;},async clear(){}};}
async function until(fn){for(let n=0;n<100;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.ok(fn(),'DOM state did not settle');}
function setup(drive,configured=true){const errors=[];const console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));const dom=new JSDOM('<div id="app"></div><dialog id="detail"></dialog><dialog id="historyDetail"></dialog><div id="toast"></div>',{url:'https://ieum.example.invalid/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});const w=dom.window;
 Object.assign(w,{testDrive:drive,testConfigured:configured,matchMedia:()=>({matches:false}),structuredClone,TextEncoder,TextDecoder,fetch:async()=>{throw Error('external network disabled in test');}});
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.HTMLElement.prototype.scrollIntoView=function(){};w.Element.prototype.getAnimations=function(){return [];};
 w.addEventListener('error',e=>errors.push(e.message));w.eval(code);return {dom,w,errors,$:s=>w.document.querySelector(s)};
}
test('DOM login is disabled until operator supplies Microsoft setup',()=>{const {dom,$,errors}=setup(fakeDrive(),false);assert.equal($('[data-personal-login]').disabled,true);assert.equal($('input[type=password]'),null);assert.deepEqual(errors,[]);dom.window.close();});
test('DOM workflow saves task, retains failed input, reloads account data and clears on logout',async()=>{
 const drive=fakeDrive();let env=setup(drive),{$,w,dom,errors}=env;
 try{
  $('[data-personal-login]').click();await until(()=>!!$('.owner'));assert.match($('.owner').textContent,/직원 a/);
  $('[data-ai-connection]').click();$('[data-manual-title]').value='수정 견적 검토';$('[data-manual-action]').value='담당자 회신';$('[data-manual]').click();
  assert.equal($('[data-save]').disabled,false);drive.fail=true;$('[data-save]').click();await until(()=>$('[data-feedback]').textContent.includes('테스트 저장 실패'));assert.equal(drive.files.size,0);assert.equal($('[data-manual-title]').value,'수정 견적 검토');
  drive.fail=false;$('[data-save]').click();await until(()=>drive.files.size===1);await until(()=>$('[data-step="4"]').hidden===false);$('[data-finish]').click();assert.match($('#app').textContent,/수정 견적 검토/);
  assert.equal([...drive.files.values()][0].board.tables.tasks[0].next_action,'담당자 회신');
  // Open task and modify through existing progress form.
  $('[data-task]').click();$('#manageTask').click();$('[data-edit-form] [name=note]').value='본인 메모';$('[data-edit-form]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>drive.files.size===2);await until(()=>$('[data-edit-feedback]').textContent.includes('저장했습니다'));
  assert.equal([...drive.files.values()].at(-1).board.tables.tasks[0].note,'본인 메모');
  $('[data-close-edit]').click();$('#detail').close();$('[data-compose]').click();$('#conversationText').value='내일 담당자에게 확인';$('#conversationText').dispatchEvent(new w.Event('input',{bubbles:true}));$('#conversationForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>drive.files.size===3);await until(()=>!$('#detail').open);assert.equal([...drive.files.values()].at(-1).board.tables.workdesk_messages[0].body,'내일 담당자에게 확인');
  assert.deepEqual(errors,[]);dom.window.close();
  env=setup(drive);({$,w,dom,errors}=env);$('[data-personal-login]').click();await until(()=>!!$('.owner'));
  $('[data-task-filter="all"]')?.click();assert.match($('#app').textContent,/본인 메모/);
  $('[data-password]').click();assert.match($('#historyDetail').textContent,/백업 복원/);$('[data-close]').click();
  $('[data-logout]').click();await until(()=>!!$('[data-personal-login]'));assert.equal($('#historyDetail').innerHTML,'');assert.doesNotMatch($('#app').textContent,/본인 메모|수정 견적/);
  drive.user='b';$('[data-personal-login]').click();await until(()=>!!$('.owner'));assert.match($('.owner').textContent,/직원 b/);assert.doesNotMatch($('#app').textContent,/본인 메모|수정 견적/);assert.deepEqual(errors,[]);
 }catch(e){console.log('DOM ERRORS',errors,'FEEDBACK',$('[data-feedback]')?.textContent,'NOTICE',$('.notice.error')?.textContent);throw e;}finally{dom.window.close();}
});
