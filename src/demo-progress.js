import {addDays} from './model.js';

// Synthetic guest examples only: 11 completed / 14 confirmed = 79% rounded.
// Keep the three current tasks open; signed-in work never uses this fixture.
export function prepareDemoProgress(tasks,date){
 const prepared=tasks.map((task,index)=>index<3?task:{...task,status:'done',pinned:false,pending_review:false,due_date:addDays(date,-(index+1)),next_review_on:null,remaining_action:'완료',next_action:'완료',note:'검토 내용과 결과를 정리하고 담당자 확인을 마친 예시 업무입니다.'});
 const titles=['회의록 정리 기준 수립','업무별 원문 링크 정리','주간업무보고 양식 정비','자료 분류와 보관 기준 정리'];
 return [...prepared,...titles.map((title,index)=>({id:'demo:completed-'+(index+1),title,project:'업무 운영',status:'done',priority:'normal',due_date:addDays(date,-(index+2)),next_review_on:null,remaining_action:'완료',next_action:'완료',note:'자료 검토와 결과 공유를 마친 예시 업무입니다.',pinned:false,revision:1,source_refs:[],created_at:addDays(date,-14)+'T09:00:00+09:00'}))];
}
