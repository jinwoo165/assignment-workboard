import {BridgeError} from './auth.js';
export const READ_TABLES=Object.freeze({tasks:['tasks','updated_at.desc,id.asc'],events:['calendar_events','start_at.asc,id.asc'],calendar_overrides:['calendar_overrides','event_id.asc'],messages:['workdesk_messages','created_at.asc,id.asc'],files:['file_changes','changed_at.desc,id.desc'],file_summaries:['file_summaries','checked_at.desc,drive_id.asc,item_id.asc'],source_status:['source_collection_results','source_id.asc'],history:['task_history','occurred_at.desc,id.desc'],links:['workspace_links','sort_order.asc,id.asc']});
export const WRITE_RPCS=Object.freeze(['assignment_ingest_feed','assignment_ingest_files','assignment_ingest_file_summaries','assignment_ingest_links','assignment_record_collection','assignment_resolve_message']);
export function createDataClient(config,identity,{fetcher=fetch}={}) {
  async function call(path,{method='GET',body}={}) {
    let response;try{response=await fetcher(`${config.supabaseUrl}/rest/v1/${path}`,{method,headers:{apikey:config.publishableKey,Authorization:`Bearer ${identity.token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000),redirect:'error'});}catch{throw new BridgeError(503,'database_unavailable','Assignment database connection failed');}
    let data;try{data=await response.json();}catch{throw new BridgeError(502,'invalid_response','Assignment database returned an unreadable response');}
    if(!response.ok){const conflict=/conflict|revision|collision/i.test(data.message||'');throw new BridgeError(conflict?409:response.status===401?401:400,conflict?'conflict':'database_rejected',conflict?'The data changed or the request ID was reused; read it again before retrying.':'The assignment database rejected this request. Check the payload and permissions.');}
    return data;
  }
  async function assertEnvironment(){const m=await call('rpc/assignment_environment',{method:'POST',body:{}});const marker=Array.isArray(m)?m[0]:m;if(marker?.environment!=='assignment'||marker?.schema_version!==1)throw new BridgeError(503,'wrong_environment','Assignment database marker is missing');}
  async function workspace(){const rows=await call('workspaces?select=id,name&limit=2');if(!Array.isArray(rows)||rows.length!==1)throw new BridgeError(403,'workspace_required','Sign in to the assignment board once to create your personal workspace');return rows[0];}
  return {
    assertEnvironment,workspace,
    async read(kind,args={}){const spec=READ_TABLES[kind];if(!spec)throw new BridgeError(400,'invalid_arguments','Unsupported collection');const w=await workspace();const q=new URLSearchParams({select:'*',workspace_id:`eq.${w.id}`,order:spec[1],limit:String(args.limit||30),offset:String(args.offset||0)});if(kind==='messages'&&args.pending_only!==false)q.set('resolution_status','eq.pending');const rows=await call(`${spec[0]}?${q}`);if(!Array.isArray(rows)||rows.some(x=>x.workspace_id!==w.id))throw new BridgeError(502,'isolation_violation','Unexpected workspace in response');return {workspace_id:w.id,items:rows,next_offset:rows.length===(args.limit||30)?(args.offset||0)+rows.length:null};},
    async write(rpc,args){if(!WRITE_RPCS.includes(rpc))throw new BridgeError(400,'invalid_arguments','RPC is not exposed');await workspace();return call(`rpc/${rpc}`,{method:'POST',body:args});}
  };
}
