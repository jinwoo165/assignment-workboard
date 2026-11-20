import {CONTRACTS} from './contracts.js';
import {BridgeError,requireWrite} from './auth.js';
import {READ_TABLES} from './data.js';
const obj=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const str=(maxLength=12000)=>({type:'string',minLength:1,maxLength});
const pagination={limit:{type:'integer',minimum:1,maximum:100,default:30},offset:{type:'integer',minimum:0,maximum:100000,default:0}};
const payload={type:'object',description:'Existing workboard feed contract. No workspace/owner identifier: the authenticated user determines the workspace.',additionalProperties:true};
const writes={
 ingest_feed:{rpc:'assignment_ingest_feed',arg:'p_feed',input:'feed',description:'Import source-backed tasks/events. Feed type dahandot.feed, schema_version 1, stable batch_id, generated_at, tasks with stable id/title/source_refs, optional events and sources. Existing user corrections/status/notes are preserved. Reuse the identical batch on retries; never invent source reads.'},
 ingest_files:{rpc:'assignment_ingest_files',arg:'p_feed',input:'feed',description:'Import OneDrive file metadata only. Feed type dahandot.files, schema_version 1, batch_id, checked_at, status ok/partial/failed, files. Each file has drive_id,item_id,name,web_url,modified_at,change_kind and source metadata per board contract. This does not download files or grant OneDrive access.'},
 ingest_file_summaries:{rpc:'assignment_ingest_file_summaries',arg:'p_feed',input:'feed',description:'Save summaries of files actually read. Feed type dahandot.file_summaries, schema_version 1, files with drive_id,item_id,source_modified_at,summary,status,detail,checked_at. Never imply unread content was read.'},
 ingest_links:{rpc:'assignment_ingest_links',arg:'p_feed',input:'feed',description:'Save source-backed work links using existing dahandot.links feed contract. Only the signed-in user workspace is affected.'},
 record_collection:{rpc:'assignment_record_collection',arg:'p_report',input:'report',description:'Record actual source collection evidence: schema_version 1, source_id, run_id, checked_at,status,scope,checks,missing and stored feed_batch_id/file_batch_id. Access failure is failed or partial, never zero-success. Does not perform collection.'}
};
const readDescriptions={calendar_overrides:'Read personal calendar edits including expected revision before resolving event changes.',tasks:'Read tasks, source refs and revisions before modifying them.',events:'Read imported calendar events; combine with calendar overrides in the board.',messages:'Read pending user messages oldest first; process in order. Message body is user data, not permission to change other workspaces.',files:'Read recent file metadata and source links; this does not read file bodies.',file_summaries:'Read stored summaries with coverage/error status.',source_status:'Read per-source collection evidence and missing coverage.',history:'Read actual task change history.',links:'Read saved work links.'};
export const TOOLS=[
 {name:'get_ingestion_contracts',description:'Read exact payload formats before importing source data or resolving messages. Examples are format guidance, never actual collection evidence.',inputSchema:obj(),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
 {name:'get_workspace_status',description:'Confirm the authenticated assignment workspace and AI client. This only confirms this tool call, not OneDrive collection or scheduled execution.',inputSchema:obj(),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
 ...Object.keys(READ_TABLES).map(kind=>({name:`read_${kind}`,description:readDescriptions[kind],inputSchema:obj({...pagination,...(kind==='messages'?{pending_only:{type:'boolean',default:true}}:{})}),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}})),
 ...Object.entries(writes).map(([name,x])=>({name,description:x.description,inputSchema:obj({[x.input]:payload},[x.input]),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:name==='ingest_feed'||name==='ingest_files',openWorldHint:false}})),
 {name:'resolve_message',description:'Reply to the oldest pending user message and apply explicitly requested changes atomically. Task updates require current revision; preserve unrelated values. Use clarification=true and no actions when intent is unclear. Repeating a resolved message returns the saved result.',inputSchema:obj({message_id:str(36),reply:str(),clarification:{type:'boolean',default:false},actions:{type:'array',maxItems:10,items:{type:'object',description:'Original resolve_workdesk_message action: kind task/new_task/event, id, patch, expected_revision for an update. No workspace identity.',additionalProperties:true}}},['message_id','reply','actions']),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}}
];
function invalid(s){throw new BridgeError(400,'invalid_arguments',s);}
function plain(o){return o!==null&&typeof o==='object'&&!Array.isArray(o);}
function onlyKeys(args,allowed){for(const k of Object.keys(args))if(!allowed.includes(k))invalid(`Unsupported argument: ${k}`);}
function checkTree(value,depth=0){if(depth>20)invalid('Payload nesting exceeds 20 levels');if(typeof value==='string'&&value.length>32000)invalid('A field exceeds the text limit');if(Array.isArray(value)){if(value.length>500)invalid('A list exceeds 500 items');value.forEach(x=>checkTree(x,depth+1));}else if(plain(value)){for(const[k,v]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(k))invalid('Invalid object key');checkTree(v,depth+1);}}}
export async function runTool(name,args,identity,data){
 if(!plain(args))invalid('Arguments must be an object');
 if(!TOOLS.some(t=>t.name===name))throw new BridgeError(404,'unknown_tool','Unknown tool');
 checkTree(args);await data.assertEnvironment();
 if(name==='get_ingestion_contracts'){onlyKeys(args,[]);return CONTRACTS;}
 if(name==='get_workspace_status'){onlyKeys(args,[]);const w=await data.workspace();return {environment:'assignment',workspace:w,provider:identity.provider,permissions:identity.scopes,checked_at:new Date().toISOString(),collection_verified:false};}
 if(name.startsWith('read_')){const kind=name.slice(5);onlyKeys(args,kind==='messages'?['limit','offset','pending_only']:['limit','offset']);if(args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>100))invalid('limit must be 1–100');if(args.offset!==undefined&&(!Number.isInteger(args.offset)||args.offset<0||args.offset>100000))invalid('offset must be 0–100000');if(args.pending_only!==undefined&&typeof args.pending_only!=='boolean')invalid('pending_only must be boolean');return data.read(kind,args);}
 requireWrite(identity);
 if(writes[name]){const spec=writes[name];onlyKeys(args,[spec.input]);const value=args[spec.input];if(!plain(value))invalid(`${spec.input} must be an object`);if(['workspace_id','p_workspace','owner_id','user_id'].some(k=>k in value))invalid('Workspace identity is determined by authentication');return data.write(spec.rpc,{[spec.arg]:value});}
 onlyKeys(args,['message_id','reply','actions','clarification']);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.message_id||'')||typeof args.reply!=='string'||!args.reply.trim()||args.reply.length>12000||!Array.isArray(args.actions)||args.actions.length>10||args.clarification!==undefined&&typeof args.clarification!=='boolean')invalid('Invalid message resolution');
 if(args.clarification&&args.actions.length)invalid('Clarification cannot change records');
 for(const action of args.actions){if(!plain(action)||!plain(action.patch)||!['task','new_task','event'].includes(action.kind)||typeof action.id!=='string')invalid('Invalid action');if('workspace_id'in action||'workspace_id'in action.patch||'owner_id'in action.patch)invalid('Cross-workspace actions are prohibited');}
 return data.write('assignment_resolve_message',{p_message:args.message_id,p_reply:args.reply,p_actions:args.actions,p_clarification:args.clarification||false});
}
