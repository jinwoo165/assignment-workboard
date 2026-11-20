// Prevent the assignment from ever falling back to the live workboard project.
export const FORBIDDEN_PROJECT_REFS = Object.freeze(['qiwgesnpcqqnmovnpvnh','mzwuwltiyzvxalqhcrzb','fhsgwfctadeuvmcmgcvl']);
export function validateAssignmentConfig(env={}) {
 const url=String(env.VITE_ASSIGNMENT_SUPABASE_URL||'').trim();
 const key=String(env.VITE_ASSIGNMENT_SUPABASE_KEY||'').trim();
 const ref=String(env.VITE_ASSIGNMENT_PROJECT_REF||'').trim();
 const mcp=String(env.VITE_ASSIGNMENT_MCP_URL||'').trim();
 if(!url&&!key&&!ref)return {configured:false,error:'과제 전용 Supabase 설정 전입니다. 운영 업무보드에는 연결하지 않습니다.',url:'',key:'',ref:'',mcp};
 let host;try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||!['','/'].includes(parsed.pathname))throw Error();host=parsed.hostname;}catch{return {configured:false,error:'과제용 Supabase HTTPS 주소를 확인해주세요.'};}
 if(!/^[a-z]{20}$/.test(ref)||host!==`${ref}.supabase.co`)return {configured:false,error:'과제 프로젝트 ID와 Supabase 주소가 일치하지 않습니다.'};
 if(FORBIDDEN_PROJECT_REFS.includes(ref))return {configured:false,error:'기존 프로젝트 연결을 차단했습니다. 새 과제용 프로젝트를 사용하세요.'};
 if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key))return {configured:false,error:'과제용 publishable key만 사용할 수 있습니다. 관리자 키는 사용할 수 없습니다.'};
 if(mcp){try{const u=new URL(mcp);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error();}catch{return {configured:false,error:'AI 연결 주소는 HTTPS MCP 주소여야 합니다.'};}}
 return {configured:true,error:'',url:`https://${host}`,key,ref,mcp};
}
