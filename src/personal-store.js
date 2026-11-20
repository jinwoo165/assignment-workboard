import {emptyBoard,validateBoard,applyOperation,restoreBoard} from './personal-state.js';
const pattern=/^board-(\d{10})\.json$/;
export class PersonalStore {
 constructor(drive,user,onStatus=()=>{}){this.drive=drive;this.user=user;this.onStatus=onStatus;this.board=emptyBoard(user.id,user.name?user.name+'의 업무보드':'내 업무보드');this.queue=Promise.resolve();this.closed=false;this.status='저장소 연결 중';}
 say(message){if(!this.closed){this.status=message;this.onStatus(message);}}
 exclusive(action){const run=this.queue.then(()=>{if(this.closed)throw Error('로그아웃한 계정입니다.');return action();});this.queue=run.catch(()=>{});return run;}
 async latest(){
  if(!this.folder)this.folder=await this.drive.read('me/drive/special/approot');
  let path=`me/drive/items/${encodeURIComponent(this.folder.id)}/children?$top=200`,latest=null;const visited=new Set();
  while(path){if(visited.has(path))throw Error('저장소 목록 응답 오류');visited.add(path);const page=await this.drive.read(path);for(const item of page.value||[]){const m=item.name?.match(pattern);if(m&&item.file&&(!latest||Number(m[1])>latest.revision))latest={...item,revision:Number(m[1])};}path=page['@odata.nextLink'];}
  return latest;
 }
 async load(){
  const latest=await this.latest();if(this.closed)throw Error('로그아웃한 계정입니다.');
  if(!latest){if(this.board.revision)throw Error('OneDrive 저장 파일이 사라졌습니다. 백업을 확인하세요.');return;}
  if(latest.revision<this.board.revision)throw Error('이전 저장 파일이 삭제되거나 변경되었습니다. OneDrive 버전 기록을 확인하세요.');
  if(latest.revision===this.board.revision){if(this.etag&&latest.eTag!==this.etag)throw Error('저장 파일이 외부에서 수정되었습니다. 원본을 복원한 후 다시 로그인하세요.');return;}
  const full=await this.drive.read('me/drive/items/'+encodeURIComponent(latest.id));
  const board=validateBoard(JSON.parse(await this.drive.download(full)),this.user.id);
  if(board.revision!==latest.revision)throw Error('저장 버전과 파일 이름이 일치하지 않습니다.');
  if(this.closed)throw Error('로그아웃한 계정입니다.');this.board=board;this.etag=full.eTag;
 }
 reload(){return this.exclusive(async()=>{try{await this.load();this.say('내 OneDrive 연결됨 · 저장 '+this.board.revision);}catch(e){this.say('저장소 확인 실패');throw e;}});}
 async commit(next){
  next.revision=this.board.revision+1;next.saved_at=new Date().toISOString();validateBoard(next,this.user.id);
  this.say('내 OneDrive에 저장 중…');
  let saved;try{saved=await this.drive.createSnapshot(this.folder.id,`board-${String(next.revision).padStart(10,'0')}.json`,next);}catch(error){this.say('저장 실패 · 입력 내용 유지');throw error;}
  if(this.closed)throw Error('로그아웃했습니다. 저장 결과는 다음 로그인에서 확인하세요.');
  this.board=next;this.etag=saved.eTag;this.say('내 OneDrive 저장 완료');
 }
 rpc(operation,p){return this.exclusive(async()=>{try{
  // Do not silently rebase stale user edits onto another device's snapshot.
  const latest=await this.latest();if((latest?.revision||0)!==this.board.revision||(this.etag&&latest?.eTag!==this.etag))throw Error('다른 창에서 업무가 변경되었습니다. 새로고침 후 다시 확인하세요.');
  const result=applyOperation(this.board,operation,p);await this.commit(result.board);return {data:result.data,error:null};
 }catch(error){this.say('저장 실패 · 입력 내용 유지');return {data:null,error};}});}
 from(table){
  if(!Object.hasOwn(this.board.tables,table))throw Error('지원하지 않는 목록: '+table);
  const filters=[],orders=[];let start=0,end=Infinity,single=false;const store=this;
  const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},gte(k,v){filters.push(r=>r[k]>=v);return q;},lt(k,v){filters.push(r=>r[k]<v);return q;},order(k,{ascending=true}={}){orders.push([k,ascending]);return q;},limit(n){end=n;return q;},range(a,b){start=a;end=b+1;return q;},single(){single=true;return q;},then(resolve,reject){return Promise.resolve().then(()=>{
   if(store.closed)throw Error('로그아웃한 계정입니다.');let data=structuredClone(store.board.tables[table]).filter(r=>filters.every(f=>f(r)));
   data.sort((a,b)=>{for(const [k,asc]of orders){const d=String(a[k]??'').localeCompare(String(b[k]??''));if(d)return asc?d:-d;}return 0;});data=data.slice(start,end);
   if(single&&data.length!==1)return {data:null,error:Error('저장 결과를 찾을 수 없습니다.')};return {data:single?data[0]:data,error:null};
  }).then(resolve,reject);}};return q;
 }
 export(){return structuredClone(this.board);}
 previewRestore(input){const board=restoreBoard(input,this.user.id);return {tasks:board.tables.tasks.length,messages:board.tables.workdesk_messages.length,links:board.tables.workspace_links.length};}
 restore(input){return this.exclusive(async()=>{const latest=await this.latest();if((latest?.revision||0)!==this.board.revision||(this.etag&&latest?.eTag!==this.etag))throw Error('다른 창에서 변경했습니다. 새로고침 후 다시 복원하세요.');const next=restoreBoard(input,this.user.id);return this.commit(next);});}
 async close(){this.closed=true;await this.queue;this.board=emptyBoard(this.user.id);this.folder=null;this.etag=null;await this.drive.clear();}
}
