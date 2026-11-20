-- ONE-TIME INITIAL INSTALL: fresh, separate Supabase assignment project only.
-- No original business data, API keys, schedules or secrets are included.
begin;
do $$ begin
 if to_regclass('public.workspaces') is not null or exists(select 1 from pg_namespace where nspname='workdesk_private') then
  raise exception 'STOP: Existing workboard schema detected. This installer only supports an empty assignment project.';
 end if;
end $$;

-- SOURCE: schema.sql
-- Public application schema. Provision workspace and allowed email separately, privately.

create schema if not exists workdesk_private;
revoke all on schema workdesk_private from public;
grant usage on schema workdesk_private to authenticated;

create table public.workspaces (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table workdesk_private.access (workspace_id uuid primary key references public.workspaces(id), allowed_email text not null);
alter table workdesk_private.access enable row level security;
create function workdesk_private.can_access(w uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false
 and exists(select 1 from workdesk_private.access a where a.workspace_id=w and lower(a.allowed_email)=lower(auth.jwt()->>'email'));
$$;
revoke all on function workdesk_private.can_access(uuid) from public,anon;
grant execute on function workdesk_private.can_access(uuid) to authenticated;
alter table public.workspaces enable row level security;
create policy owner_read on public.workspaces for select to authenticated using(workdesk_private.can_access(id));
grant select on public.workspaces to authenticated;
revoke all on public.workspaces from anon;

create table public.tasks (
 id text primary key, workspace_id uuid not null references public.workspaces(id),
 title text not null check(length(title) between 1 and 300), project text not null default '일반', owner_label text not null default '',
 status text not null default 'review' check(status in ('review','todo','doing','partial','waiting','done')),
 priority text not null default 'normal' check(priority in ('high','normal','low')),
 due_date date, next_review_on date, next_action text not null default '', remaining_action text not null default '',
 note text not null default '', pinned boolean not null default false, archived boolean not null default false,
 origin text not null default 'manual' check(origin in('manual','ai')),
 source_data jsonb not null default '{}', source_refs jsonb not null default '[]', source_at timestamptz,
 pending_review boolean not null default false, user_fields text[] not null default '{}',
 revision bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
 check(status <> 'partial' or length(trim(remaining_action)) > 0),
 check(status <> 'done' or (remaining_action='' and next_review_on is null)),
 check(jsonb_typeof(source_refs)='array'), check(length(note)<=12000), check(length(remaining_action)<=6000)
);
create index tasks_workspace_due on public.tasks(workspace_id,due_date);
create index tasks_workspace_status on public.tasks(workspace_id,status);
create table public.task_history (
 id bigint generated always as identity primary key, workspace_id uuid not null references public.workspaces(id), task_id text not null references public.tasks(id),
 occurred_at timestamptz not null default now(), actor text not null, action text not null, before_data jsonb, after_data jsonb not null
);
create index history_workspace_date on public.task_history(workspace_id,occurred_at desc);
create index history_task_date on public.task_history(task_id,occurred_at desc);
create table public.calendar_events (
 id text primary key, workspace_id uuid not null references public.workspaces(id), title text not null,
 start_at timestamptz not null, end_at timestamptz not null, all_day boolean not null default false, source text not null default '', url text not null default '',
 note text not null default '', status text not null default 'confirmed', source_at timestamptz not null, check(end_at>=start_at)
);
create index events_workspace_start on public.calendar_events(workspace_id,start_at);
create table public.sync_runs (
 id text primary key, workspace_id uuid not null references public.workspaces(id), generated_at timestamptz not null,
 imported_at timestamptz not null default now(), summary text not null default '', sources jsonb not null default '[]', fingerprint text not null,
 added integer not null default 0, updated integer not null default 0
);
create index runs_workspace_date on public.sync_runs(workspace_id,generated_at desc);
create table public.workspace_links (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id), label text not null, url text not null, description text not null default '', sort_order integer not null default 0
);
create index links_workspace on public.workspace_links(workspace_id);

do $$ declare t text; begin
 foreach t in array array['tasks','task_history','calendar_events','sync_runs','workspace_links'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy owner_read on public.%I for select to authenticated using (workdesk_private.can_access(workspace_id))',t);
 end loop;
end $$;
grant insert,update on public.tasks to authenticated;
create policy owner_insert on public.tasks for insert to authenticated with check(workdesk_private.can_access(workspace_id) and origin='manual');
create policy owner_update on public.tasks for update to authenticated using(workdesk_private.can_access(workspace_id)) with check(workdesk_private.can_access(workspace_id));

create function workdesk_private.before_task() returns trigger language plpgsql set search_path='' as $$
declare f text; fields text[] := array['title','project','owner_label','due_date','priority','next_action'];
begin
 if TG_OP='UPDATE' then
   if new.id<>old.id or new.workspace_id<>old.workspace_id then raise exception 'Immutable identity'; end if;
   if current_user='authenticated' then
     if new.origin<>old.origin or new.source_data<>old.source_data or new.source_refs<>old.source_refs or new.source_at is distinct from old.source_at then raise exception 'Source fields are managed by collector'; end if;
     new.user_fields:=old.user_fields;
     foreach f in array fields loop
       if to_jsonb(new)->f is distinct from to_jsonb(old)->f and not f=any(new.user_fields) then new.user_fields:=array_append(new.user_fields,f); end if;
     end loop;
   end if;
   new.created_at:=old.created_at;
   new.revision:=old.revision+1;
 else
   new.revision:=1; new.created_at:=now();
   if current_user='authenticated' then new.origin:='manual'; new.source_data:='{}'; new.source_refs:='[]'; new.source_at:=null; new.user_fields:='{}'; end if;
 end if;
 new.updated_at:=now();
 if new.status='done' then
   if TG_OP='INSERT' or old.status<>'done' then new.completed_at:=now(); else new.completed_at:=old.completed_at; end if;
 else new.completed_at:=null; end if;
 return new;
end $$;
revoke all on function workdesk_private.before_task() from public;
create trigger task_before before insert or update on public.tasks for each row execute function workdesk_private.before_task();
create function workdesk_private.log_task() returns trigger language plpgsql security definer set search_path='' as $$
declare a text; actor_name text;
begin
 if auth.uid() is not null then
   if not workdesk_private.can_access(new.workspace_id) then raise exception 'Not authorized'; end if;
   actor_name:='본인';
 else actor_name:='다한닷'; end if;
 a:=case when TG_OP='INSERT' then '업무 등록' when new.archived and not old.archived then '보관' when not new.archived and old.archived then '복원' when new.status is distinct from old.status then '상태 변경' when new.note is distinct from old.note then '메모 작성' when new.source_data is distinct from old.source_data then '조회 반영' else '업무 수정' end;
 insert into public.task_history(workspace_id,task_id,actor,action,before_data,after_data) values(new.workspace_id,new.id,actor_name,a,case when TG_OP='UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
 return new;
end $$;
revoke all on function workdesk_private.log_task() from public;
create trigger task_log after insert or update on public.tasks for each row execute function workdesk_private.log_task();

create function public.save_task(p_id text,p_expected bigint,p_patch jsonb) returns public.tasks language plpgsql security invoker set search_path='' as $$
declare t public.tasks; w uuid; begin
 select id into w from public.workspaces limit 1;
 if w is null then raise exception 'Access denied'; end if;
 if p_expected is null then
   insert into public.tasks(id,workspace_id,title) values(p_id,w,coalesce(nullif(trim(p_patch->>'title'),''),'새 업무')) returning * into t;
 else
   select * into t from public.tasks where id=p_id for update;
   if not found then raise exception 'Task not found'; end if;
   if t.revision<>p_expected then raise exception 'CONFLICT: 다른 기기에서 변경되었습니다. 다시 열어 확인하세요.'; end if;
 end if;
 update public.tasks set
 title=case when p_patch?'title' then trim(p_patch->>'title') else t.title end,
 project=case when p_patch?'project' then coalesce(nullif(p_patch->>'project',''),'일반') else t.project end,
 owner_label=case when p_patch?'owner_label' then p_patch->>'owner_label' else t.owner_label end,
 status=case when p_patch?'status' then p_patch->>'status' else t.status end,
 priority=case when p_patch?'priority' then p_patch->>'priority' else t.priority end,
 due_date=case when p_patch?'due_date' then nullif(p_patch->>'due_date','')::date else t.due_date end,
 next_review_on=case when p_patch?'next_review_on' then nullif(p_patch->>'next_review_on','')::date else t.next_review_on end,
 next_action=case when p_patch?'next_action' then p_patch->>'next_action' else t.next_action end,
 remaining_action=case when p_patch?'remaining_action' then p_patch->>'remaining_action' else t.remaining_action end,
 note=case when p_patch?'note' then p_patch->>'note' else t.note end,
 pinned=case when p_patch?'pinned' then (p_patch->>'pinned')::boolean else t.pinned end,
 archived=case when p_patch?'archived' then (p_patch->>'archived')::boolean else t.archived end,
 pending_review=case when p_patch?'pending_review' then (p_patch->>'pending_review')::boolean else t.pending_review end
 where id=p_id returning * into t;
 return t;
end $$;
revoke all on function public.save_task(text,bigint,jsonb) from public,anon;
grant execute on function public.save_task(text,bigint,jsonb) to authenticated;

-- Collector-only transaction. Never grants execution to a browser role.
create function public.ingest_workdesk_feed(p_workspace uuid,p_feed jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare x jsonb; t public.tasks; dt timestamptz; fp text; oldfp text; adds int:=0; updates int:=0; fields text[]; f text; changed boolean;
begin
 if coalesce(p_feed->>'type','')<>'dahandot.feed' or coalesce((p_feed->>'schema_version')::int,0)<>1 then raise exception 'Invalid feed'; end if;
 dt:=(p_feed->>'generated_at')::timestamptz; fp:=md5(p_feed::text);
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text,0));
 select fingerprint into oldfp from public.sync_runs where id=p_feed->>'batch_id';
 if found then if oldfp<>fp then raise exception 'Batch ID content conflict'; end if; return jsonb_build_object('duplicate',true); end if;
 for x in select value from jsonb_array_elements(p_feed->'tasks') loop
   if length(coalesce(x->>'id',''))=0 or jsonb_array_length(coalesce(x->'source_refs','[]'))=0 then raise exception 'Task identity and sources required'; end if;
   select * into t from public.tasks where id=x->>'id' for update;
   if not found then
     insert into public.tasks(id,workspace_id,title,project,owner_label,due_date,priority,next_action,origin,source_data,source_refs,source_at)
     values(x->>'id',p_workspace,x->>'title',coalesce(x->>'project','일반'),coalesce(x->>'owner',''),nullif(x->>'due_date','')::date,coalesce(x->>'priority','normal'),coalesce(x->>'next_action',''),'ai',x,coalesce(x->'source_refs','[]'),dt);
     adds:=adds+1;
   else
     if t.workspace_id<>p_workspace or t.origin<>'ai' then raise exception 'Identity collision'; end if;
     if dt< t.source_at then continue; end if;
     if t.source_data=x then continue; end if;
     changed:= (t.source_data - 'source_refs') is distinct from (x - 'source_refs');
     -- User status/notes/remaining work/review date are NEVER changed by collection.
     update public.tasks set
       title=case when 'title'=any(t.user_fields) then t.title else x->>'title' end,
       project=case when 'project'=any(t.user_fields) then t.project else coalesce(x->>'project','일반') end,
       owner_label=case when 'owner_label'=any(t.user_fields) then t.owner_label else coalesce(x->>'owner','') end,
       due_date=case when 'due_date'=any(t.user_fields) then t.due_date else nullif(x->>'due_date','')::date end,
       priority=case when 'priority'=any(t.user_fields) then t.priority else coalesce(x->>'priority','normal') end,
       next_action=case when 'next_action'=any(t.user_fields) then t.next_action else coalesce(x->>'next_action','') end,
       source_data=x,source_refs=coalesce(x->'source_refs','[]'),source_at=dt,pending_review=t.pending_review or changed
     where id=t.id;
     updates:=updates+1;
   end if;
 end loop;
 for x in select value from jsonb_array_elements(coalesce(p_feed->'events','[]')) loop
   insert into public.calendar_events(id,workspace_id,title,start_at,end_at,all_day,source,url,note,status,source_at)
   values(x->>'id',p_workspace,x->>'title',case when (x->>'all_day')::boolean then (x->>'start')::date::timestamp at time zone 'Asia/Seoul' else (x->>'start')::timestamptz end,
   case when (x->>'all_day')::boolean then (x->>'end')::date::timestamp at time zone 'Asia/Seoul' else (x->>'end')::timestamptz end,
   coalesce((x->>'all_day')::boolean,false),coalesce(x->>'source',''),coalesce(x->>'url',''),coalesce(x->>'note',''),coalesce(x->>'status','confirmed'),dt)
   on conflict(id) do update set title=excluded.title,start_at=excluded.start_at,end_at=excluded.end_at,all_day=excluded.all_day,source=excluded.source,url=excluded.url,note=excluded.note,status=excluded.status,source_at=excluded.source_at
   where public.calendar_events.workspace_id=p_workspace and public.calendar_events.source_at<=excluded.source_at;
 end loop;
 insert into public.sync_runs(id,workspace_id,generated_at,summary,sources,fingerprint,added,updated)
 values(p_feed->>'batch_id',p_workspace,dt,coalesce(p_feed->>'summary',''),coalesce(p_feed->'sources','[]'),fp,adds,updates);
 return jsonb_build_object('added',adds,'updated',updates,'duplicate',false);
end $$;
revoke all on function public.ingest_workdesk_feed(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_workdesk_feed(uuid,jsonb) to service_role;

alter publication supabase_realtime add table public.tasks, public.task_history, public.calendar_events, public.sync_runs;

;

-- SOURCE: conversations.sql
-- Additive v2.1 migration. Apply once after schema.sql; no existing data is removed.

create table public.workdesk_messages (
 id uuid primary key, workspace_id uuid not null references public.workspaces(id),
 task_id text references public.tasks(id), event_id text references public.calendar_events(id),
 body text not null check(length(trim(body)) between 1 and 12000),
 created_at timestamptz not null default now(), base_revision bigint,
 resolution_status text not null default 'pending' check(resolution_status in ('pending','applied','clarification')),
 reply text not null default '', resolved_at timestamptz, changes jsonb not null default '[]',
 check(num_nonnulls(task_id,event_id)<=1), check(jsonb_typeof(changes)='array')
);
create index messages_workspace_date on public.workdesk_messages(workspace_id,created_at,id);
create index messages_pending on public.workdesk_messages(workspace_id,created_at,id) where resolution_status='pending';
create index messages_task on public.workdesk_messages(task_id,created_at);
create index messages_event on public.workdesk_messages(event_id,created_at);
alter table public.workdesk_messages enable row level security;
revoke all on public.workdesk_messages from anon,authenticated;
grant select on public.workdesk_messages to authenticated;
grant insert(id,workspace_id,task_id,event_id,body) on public.workdesk_messages to authenticated;
create policy owner_read on public.workdesk_messages for select to authenticated using(workdesk_private.can_access(workspace_id));
create policy owner_insert on public.workdesk_messages for insert to authenticated with check(workdesk_private.can_access(workspace_id));

create function workdesk_private.message_before_insert() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.task_id is not null then
   select revision into new.base_revision from public.tasks where id=new.task_id and workspace_id=new.workspace_id;
   if not found then raise exception 'Task not found in workspace'; end if;
 end if;
 if new.event_id is not null and not exists(select 1 from public.calendar_events where id=new.event_id and workspace_id=new.workspace_id) then
   raise exception 'Event not found in workspace';
 end if;
 new.body:=trim(new.body); new.created_at:=clock_timestamp();
 new.resolution_status:='pending'; new.reply:=''; new.resolved_at:=null; new.changes:='[]';
 return new;
end $$;
revoke all on function workdesk_private.message_before_insert() from public,anon,authenticated;
create trigger message_insert before insert on public.workdesk_messages for each row execute function workdesk_private.message_before_insert();

create function public.record_workdesk_message(p_workspace uuid,p_id uuid,p_body text,p_task_id text default null,p_event_id text default null)
returns public.workdesk_messages language plpgsql security invoker set search_path='' as $$
declare m public.workdesk_messages;
begin
 if not workdesk_private.can_access(p_workspace) then raise exception 'Access denied'; end if;
 -- A retried send has the same UUID and content; it never inserts twice.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,1));
 select * into m from public.workdesk_messages where id=p_id;
 if found then
   if m.workspace_id<>p_workspace or m.body<>trim(p_body) or m.task_id is distinct from p_task_id or m.event_id is distinct from p_event_id then
     raise exception 'Message ID conflict';
   end if;
   return m;
 end if;
 insert into public.workdesk_messages(id,workspace_id,task_id,event_id,body)
 values(p_id,p_workspace,p_task_id,p_event_id,p_body) returning * into m;
 return m;
end $$;
revoke all on function public.record_workdesk_message(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.record_workdesk_message(uuid,uuid,text,text,text) to authenticated;

-- Personal display preferences are separate from the imported calendar source.
create table public.calendar_overrides (
 event_id text primary key references public.calendar_events(id), workspace_id uuid not null references public.workspaces(id),
 excluded boolean not null default false, start_at timestamptz, end_at timestamptz,
 reason text not null default '', revision bigint not null default 1, updated_at timestamptz not null default now(),
 check((start_at is null and end_at is null) or (start_at is not null and end_at is not null and end_at>=start_at))
);
create index overrides_workspace on public.calendar_overrides(workspace_id);
alter table public.calendar_overrides enable row level security;
revoke all on public.calendar_overrides from anon,authenticated;
grant select on public.calendar_overrides to authenticated;
create policy owner_read on public.calendar_overrides for select to authenticated using(workdesk_private.can_access(workspace_id));

-- Only the authorized agent/collector can interpret a message and apply a result.
-- The browser can submit plain text but cannot forge an assistant response.
create function public.resolve_workdesk_message(p_message uuid,p_reply text,p_actions jsonb default '[]',p_clarification boolean default false)
returns public.workdesk_messages language plpgsql security invoker set search_path='' as $$
declare
 m public.workdesk_messages; t public.tasks; ev public.calendar_events; ov public.calendar_overrides;
 a jsonb; p jsonb; before_row jsonb; after_row jsonb; result_changes jsonb:='[]'; f text; fields text[];
 action_id text; is_new boolean; override_exists boolean; expected_revision bigint;
begin
 select * into m from public.workdesk_messages where id=p_message for update;
 if not found then raise exception 'Message not found'; end if;
 perform pg_advisory_xact_lock(hashtextextended(m.workspace_id::text,0));
 if m.resolution_status<>'pending' then return m; end if;
 if length(trim(coalesce(p_reply,''))) not between 1 and 12000 then raise exception 'Reply required'; end if;
 if jsonb_typeof(p_actions) is distinct from 'array' or jsonb_array_length(p_actions)>10 then raise exception 'Invalid actions'; end if;
 if p_clarification and jsonb_array_length(p_actions)>0 then raise exception 'Clarification cannot change records'; end if;
 if exists(select 1 from public.workdesk_messages x where x.workspace_id=m.workspace_id and x.resolution_status='pending' and (x.created_at,x.id)<(m.created_at,m.id)) then
   raise exception 'Process earlier pending conversations first';
 end if;
 for a in select value from jsonb_array_elements(p_actions) loop
   p:=a->'patch'; action_id:=a->>'id';
   if jsonb_typeof(p) is distinct from 'object' or length(coalesce(action_id,''))=0 then raise exception 'Invalid action patch'; end if;
   if a->>'kind' in ('task','new_task') then
     is_new:=a->>'kind'='new_task';
     if exists(select 1 from jsonb_object_keys(p) k where k not in ('title','project','owner_label','status','priority','due_date','next_review_on','next_action','remaining_action','note','pinned','archived','pending_review')) then raise exception 'Unsupported task field'; end if;
     if is_new then
       if action_id not like 'conversation:%' or length(trim(coalesce(p->>'title','')))=0 then raise exception 'New task identity and title required'; end if;
       insert into public.tasks(id,workspace_id,title) values(action_id,m.workspace_id,trim(p->>'title')) returning * into t;
       before_row:=null;
     else
       select * into t from public.tasks where id=action_id and workspace_id=m.workspace_id for update;
       if not found then raise exception 'Task not found in workspace'; end if;
       expected_revision:=(a->>'expected_revision')::bigint;
       if expected_revision is null or expected_revision<>t.revision then raise exception 'CONFLICT: task changed; read again before interpreting'; end if;
       before_row:=to_jsonb(t);
     end if;
     fields:=t.user_fields;
     foreach f in array array['title','project','owner_label','due_date','priority','next_action'] loop
       if p?f and not f=any(fields) then fields:=array_append(fields,f); end if;
     end loop;
     update public.tasks set
       title=case when p?'title' then trim(p->>'title') else t.title end,
       project=case when p?'project' then coalesce(nullif(p->>'project',''),'일반') else t.project end,
       owner_label=case when p?'owner_label' then p->>'owner_label' else t.owner_label end,
       status=case when p?'status' then p->>'status' else t.status end,
       priority=case when p?'priority' then p->>'priority' else t.priority end,
       due_date=case when p?'due_date' then nullif(p->>'due_date','')::date else t.due_date end,
       next_review_on=case when p?'next_review_on' then nullif(p->>'next_review_on','')::date else t.next_review_on end,
       next_action=case when p?'next_action' then p->>'next_action' else t.next_action end,
       remaining_action=case when p?'remaining_action' then p->>'remaining_action' else t.remaining_action end,
       note=case when p?'note' then p->>'note' else t.note end,
       pinned=case when p?'pinned' then (p->>'pinned')::boolean else t.pinned end,
       archived=case when p?'archived' then (p->>'archived')::boolean else t.archived end,
       pending_review=case when p?'pending_review' then (p->>'pending_review')::boolean else t.pending_review end,
       user_fields=fields
       where id=t.id returning to_jsonb(tasks.*) into after_row;
   elsif a->>'kind'='event' then
     if exists(select 1 from jsonb_object_keys(p) k where k not in ('excluded','start_at','end_at','reason')) then raise exception 'Unsupported event field'; end if;
     select * into ev from public.calendar_events where id=action_id and workspace_id=m.workspace_id for update;
     if not found then raise exception 'Event not found in workspace'; end if;
     if (a->>'expected_source_at')::timestamptz is distinct from ev.source_at then raise exception 'CONFLICT: calendar source changed'; end if;
     select * into ov from public.calendar_overrides where event_id=action_id for update;
     override_exists:=found;
     expected_revision:=case when override_exists then ov.revision else 0 end;
     if (a->>'expected_revision')::bigint is distinct from expected_revision then raise exception 'CONFLICT: calendar preference changed'; end if;
     if override_exists and ov.workspace_id<>m.workspace_id then raise exception 'Workspace conflict'; end if;
     before_row:=jsonb_build_object('source',to_jsonb(ev),'override',case when override_exists then to_jsonb(ov) else null end);
     insert into public.calendar_overrides(event_id,workspace_id,excluded,start_at,end_at,reason,revision)
     values(action_id,m.workspace_id,
       case when p?'excluded' then (p->>'excluded')::boolean else coalesce(ov.excluded,false) end,
       case when p?'start_at' then nullif(p->>'start_at','')::timestamptz else ov.start_at end,
       case when p?'end_at' then nullif(p->>'end_at','')::timestamptz else ov.end_at end,
       case when p?'reason' then p->>'reason' else coalesce(ov.reason,'') end,
       case when override_exists then ov.revision+1 else 1 end)
     on conflict(event_id) do update set excluded=excluded.excluded,start_at=excluded.start_at,end_at=excluded.end_at,reason=excluded.reason,revision=excluded.revision,updated_at=now()
     returning to_jsonb(calendar_overrides.*) into after_row;
   else raise exception 'Unsupported action kind';
   end if;
   result_changes:=result_changes||jsonb_build_array(jsonb_build_object('kind',a->>'kind','id',action_id,'before',before_row,'after',after_row));
 end loop;
 update public.workdesk_messages set resolution_status=case when p_clarification then 'clarification' else 'applied' end,
 reply=trim(p_reply),resolved_at=now(),changes=result_changes where id=m.id returning * into m;
 return m;
end $$;
revoke all on function public.resolve_workdesk_message(uuid,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.resolve_workdesk_message(uuid,text,jsonb,boolean) to service_role;
alter publication supabase_realtime add table public.workdesk_messages,public.calendar_overrides;

;

-- SOURCE: files.sql
-- v2.2: metadata-only OneDrive changes, privately collected and read-only in the app.

create table public.file_changes (
 id bigint generated always as identity primary key,
 workspace_id uuid not null references public.workspaces(id),
 drive_id text not null, item_id text not null,
 name text not null check(length(name) between 1 and 500),
 web_url text not null check(web_url ~ '^https://[^/@?#[:space:]]+\.sharepoint\.com/'),
 folder_path text not null default '',
 created_at_source timestamptz, modified_at_source timestamptz not null,
 changed_at timestamptz not null,
 change_kind text not null check(change_kind in ('created','modified')),
 observed_at timestamptz not null,
 unique(workspace_id,drive_id,item_id,changed_at)
);
create index file_changes_workspace_date on public.file_changes(workspace_id,changed_at desc,id desc);
create table public.file_sync_runs (
 id text primary key, workspace_id uuid not null references public.workspaces(id),
 checked_at timestamptz not null, status text not null check(status in ('ok','partial','failed')),
 detail text not null default '', file_count integer not null default 0,
 fingerprint text not null, imported_at timestamptz not null default now()
);
create index file_sync_workspace_date on public.file_sync_runs(workspace_id,checked_at desc);
do $$ declare t text; begin
 foreach t in array array['file_changes','file_sync_runs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
  execute format('create policy owner_read on public.%I for select to authenticated using (workdesk_private.can_access(workspace_id))',t);
 end loop;
end $$;
grant usage,select on sequence public.file_changes_id_seq to service_role;

create function public.ingest_workdesk_files(p_workspace uuid,p_feed jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare x jsonb; stamp timestamptz; created timestamptz; modified timestamptz; changed timestamptz;
 fp text; existing public.file_sync_runs; total integer:=0; n integer;
begin
 if p_feed->>'type' is distinct from 'dahandot.files' or p_feed->>'schema_version' is distinct from '1'
  or coalesce(length(p_feed->>'batch_id'),0) not between 1 and 200
  or jsonb_typeof(p_feed->'files') is distinct from 'array'
  or p_feed->>'status' not in ('ok','partial','failed') or p_feed->>'status' is null
  or nullif(p_feed->>'checked_at','') is null then raise exception 'Invalid file feed'; end if;
 if jsonb_array_length(p_feed->'files')>500 then raise exception 'File batch exceeds 500'; end if;
 if p_feed->>'status'='failed' and jsonb_array_length(p_feed->'files')>0 then raise exception 'Failed check cannot contain files'; end if;
 stamp:=(p_feed->>'checked_at')::timestamptz;
 if stamp>now()+interval '5 minutes' then raise exception 'Future check time'; end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 if not found then raise exception 'Workspace not found'; end if;
 fp:=md5(p_feed::text);
 select * into existing from public.file_sync_runs where id=p_feed->>'batch_id';
 if found then
  if existing.workspace_id<>p_workspace or existing.fingerprint<>fp then raise exception 'Batch identity conflict'; end if;
  return jsonb_build_object('duplicate',true,'added',0);
 end if;
 if exists(select 1 from public.file_sync_runs where workspace_id=p_workspace and checked_at>stamp) then raise exception 'Outdated file feed'; end if;
 for x in select value from jsonb_array_elements(p_feed->'files') loop
  if coalesce(length(x->>'drive_id'),0)=0 or coalesce(length(x->>'item_id'),0)=0
   or nullif(x->>'modified_at','') is null then raise exception 'Missing file identity or modification time'; end if;
  created:=nullif(x->>'created_at','')::timestamptz; modified:=(x->>'modified_at')::timestamptz;
  changed:=greatest(created,modified);
  if changed>stamp+interval '5 minutes' then raise exception 'Future file timestamp'; end if;
  insert into public.file_changes(workspace_id,drive_id,item_id,name,web_url,folder_path,created_at_source,modified_at_source,changed_at,change_kind,observed_at)
  values(p_workspace,x->>'drive_id',x->>'item_id',x->>'name',x->>'web_url',coalesce(x->>'folder_path',''),created,modified,changed,
   case when created is not null and created>=modified-interval '2 seconds' then 'created' else 'modified' end,stamp)
  on conflict(workspace_id,drive_id,item_id,changed_at) do nothing;
  get diagnostics n=row_count;total:=total+n;
 end loop;
 insert into public.file_sync_runs(id,workspace_id,checked_at,status,detail,file_count,fingerprint)
 values(p_feed->>'batch_id',p_workspace,stamp,p_feed->>'status',coalesce(p_feed->>'detail',''),jsonb_array_length(p_feed->'files'),fp);
 return jsonb_build_object('duplicate',false,'added',total);
end $$;
revoke all on function public.ingest_workdesk_files(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_workdesk_files(uuid,jsonb) to service_role;
alter publication supabase_realtime add table public.file_changes,public.file_sync_runs;

;

-- SOURCE: managed-links.sql
-- Private bookmarks with owner removal and collector suppression of removed URLs.

alter table public.workspace_links add column removed_at timestamptz,
 add column source_checked_at timestamptz;
create unique index links_workspace_url on public.workspace_links(workspace_id,url);

create function public.set_workdesk_link_removed(p_link uuid,p_removed boolean)
returns public.workspace_links language plpgsql security definer set search_path='' as $$
declare item public.workspace_links;
begin
 if p_removed is null then raise exception 'Removal state required'; end if;
 select * into item from public.workspace_links where id=p_link and workdesk_private.can_access(workspace_id) for update;
 if not found then raise exception 'Link not available'; end if;
 update public.workspace_links set removed_at=case when p_removed then coalesce(removed_at,now()) else null end
 where id=p_link returning * into item;
 return item;
end $$;
revoke all on function public.set_workdesk_link_removed(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_workdesk_link_removed(uuid,boolean) to authenticated;

create function public.ingest_workdesk_links(p_workspace uuid,p_feed jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare x jsonb; stamp timestamptz; item public.workspace_links; address text;
 added integer:=0; changed integer:=0; suppressed integer:=0; position integer;
begin
 if p_feed->>'type' is distinct from 'dahandot.links' or p_feed->>'schema_version' is distinct from '1'
 or jsonb_typeof(p_feed->'links') is distinct from 'array' or jsonb_array_length(p_feed->'links')>30
 or coalesce(p_feed->>'checked_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Invalid link feed'; end if;
 stamp:=(p_feed->>'checked_at')::timestamptz;
 if stamp>now()+interval '5 minutes' then raise exception 'Future source time'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace::text,4));
 select coalesce(max(sort_order),-1)+1 into position from public.workspace_links where workspace_id=p_workspace;
 for x in select value from pg_catalog.jsonb_array_elements(p_feed->'links') loop
  address:=trim(x->>'url');
  if coalesce(length(address),0) not between 1 and 4000
   or address !~ '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$'
   or coalesce(length(trim(x->>'label')),0) not between 1 and 200
   or length(coalesce(x->>'description',''))>1000 then raise exception 'Invalid link'; end if;
  select * into item from public.workspace_links where workspace_id=p_workspace and url=address for update;
  if found then
   if item.removed_at is not null then suppressed:=suppressed+1;continue;end if;
   if item.source_checked_at is not null and stamp<=item.source_checked_at then continue;end if;
   update public.workspace_links set label=trim(x->>'label'),description=coalesce(x->>'description',''),source_checked_at=stamp where id=item.id;
   changed:=changed+1;
  else
   insert into public.workspace_links(workspace_id,label,url,description,sort_order,source_checked_at)
   values(p_workspace,trim(x->>'label'),address,coalesce(x->>'description',''),position,stamp);
   position:=position+1;added:=added+1;
  end if;
 end loop;
 return pg_catalog.jsonb_build_object('added',added,'updated',changed,'suppressed',suppressed);
end $$;
revoke all on function public.ingest_workdesk_links(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_workdesk_links(uuid,jsonb) to service_role;
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='workspace_links')
 then alter publication supabase_realtime add table public.workspace_links;end if;
end $$;

;

-- SOURCE: link-pins.sql
-- Apply after managed-links.sql. Existing links deliberately retain unknown added_at.

alter table public.workspace_links add column added_at timestamptz;
alter table public.workspace_links alter column added_at set default now();
alter table public.workspace_links add column pinned_at timestamptz;

-- Share the ingestion lock. Never grant browser roles direct writes to links.
create function workdesk_private.guard_workdesk_link_pins()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.removed_at is not null then new.pinned_at:=null; end if;
 if new.pinned_at is not null then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.workspace_id::text,4));
  if (select count(*) from public.workspace_links
      where workspace_id=new.workspace_id and removed_at is null
      and pinned_at is not null and id<>new.id)>=7 then
   raise exception '상위 고정은 최대 7개까지 가능합니다.' using errcode='23514';
  end if;
 end if;
 return new;
end $$;
revoke all on function workdesk_private.guard_workdesk_link_pins() from public,anon,authenticated;
create trigger guard_workdesk_link_pins before insert or update of pinned_at,removed_at,workspace_id
on public.workspace_links for each row execute function workdesk_private.guard_workdesk_link_pins();

create function public.set_workdesk_link_pinned(p_link uuid,p_pinned boolean)
returns public.workspace_links language plpgsql security definer set search_path='' as $$
declare item public.workspace_links; workspace uuid;
begin
 if p_pinned is null then raise exception 'Pin state required'; end if;
 select workspace_id into workspace from public.workspace_links
 where id=p_link and workdesk_private.can_access(workspace_id);
 if not found then raise exception 'Link not available'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(workspace::text,4));
 select * into item from public.workspace_links
 where id=p_link and workspace_id=workspace and workdesk_private.can_access(workspace_id) for update;
 if not found then raise exception 'Link not available'; end if;
 if p_pinned and item.removed_at is not null then raise exception 'Removed links cannot be pinned'; end if;
 update public.workspace_links
 set pinned_at=case when p_pinned then coalesce(pinned_at,now()) else null end
 where id=p_link returning * into item;
 return item;
end $$;
revoke all on function public.set_workdesk_link_pinned(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_workdesk_link_pinned(uuid,boolean) to authenticated;

create or replace function public.set_workdesk_link_removed(p_link uuid,p_removed boolean)
returns public.workspace_links language plpgsql security definer set search_path='' as $$
declare item public.workspace_links; workspace uuid;
begin
 if p_removed is null then raise exception 'Removal state required'; end if;
 select workspace_id into workspace from public.workspace_links
 where id=p_link and workdesk_private.can_access(workspace_id);
 if not found then raise exception 'Link not available'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(workspace::text,4));
 select * into item from public.workspace_links
 where id=p_link and workspace_id=workspace and workdesk_private.can_access(workspace_id) for update;
 if not found then raise exception 'Link not available'; end if;
 update public.workspace_links
 set removed_at=case when p_removed then coalesce(removed_at,now()) else null end,
 pinned_at=case when p_removed or item.removed_at is not null then null else pinned_at end
 where id=p_link returning * into item;
 return item;
end $$;
revoke all on function public.set_workdesk_link_removed(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_workdesk_link_removed(uuid,boolean) to authenticated;
notify pgrst,'reload schema';

;

-- SOURCE: file-summaries.sql
-- Concise source-content summaries; never store full reports or attachments here.

create table public.file_summaries (
 workspace_id uuid not null references public.workspaces(id),
 drive_id text not null, item_id text not null,
 source_modified_at timestamptz not null,
 summary text not null default '' check(length(summary)<=1000),
 status text not null check(status in ('ok','partial','failed','unsupported')),
 detail text not null default '' check(length(detail)<=4000),
 checked_at timestamptz not null,
 primary key(workspace_id,drive_id,item_id),
 check((status in ('ok','partial') and length(trim(summary))>0) or (status in ('failed','unsupported') and summary=''))
);
alter table public.file_summaries enable row level security;
revoke all on public.file_summaries from public,anon,authenticated;
grant select on public.file_summaries to authenticated;
grant all on public.file_summaries to service_role;
create policy owner_read on public.file_summaries for select to authenticated
 using(workdesk_private.can_access(workspace_id));

create function public.ingest_workdesk_file_summaries(p_workspace uuid,p_feed jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare x jsonb; stamp timestamptz; modified timestamptz; total integer:=0; n integer;
begin
 if p_feed->>'type' is distinct from 'dahandot.file_summaries'
 or p_feed->>'schema_version' is distinct from '1'
 or jsonb_typeof(p_feed->'files') is distinct from 'array'
 or jsonb_array_length(p_feed->'files')>100 then raise exception 'Invalid summary feed'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace::text,3));
 for x in select value from pg_catalog.jsonb_array_elements(p_feed->'files') loop
  if coalesce(x->>'checked_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
   or coalesce(x->>'source_modified_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Timezone required'; end if;
  stamp:=(x->>'checked_at')::timestamptz; modified:=(x->>'source_modified_at')::timestamptz;
  if stamp>now()+interval '5 minutes' or modified>stamp+interval '5 minutes' then raise exception 'Future summary time'; end if;
  if not exists(select 1 from public.file_changes f where f.workspace_id=p_workspace
   and f.drive_id=x->>'drive_id' and f.item_id=x->>'item_id' and f.modified_at_source=modified)
   then raise exception 'Collect the verified source version first'; end if;
  insert into public.file_summaries as existing(workspace_id,drive_id,item_id,source_modified_at,summary,status,detail,checked_at)
  values(p_workspace,x->>'drive_id',x->>'item_id',modified,coalesce(x->>'summary',''),x->>'status',coalesce(x->>'detail',''),stamp)
  on conflict(workspace_id,drive_id,item_id) do update set
   source_modified_at=excluded.source_modified_at,summary=excluded.summary,status=excluded.status,
   detail=excluded.detail,checked_at=excluded.checked_at
  where excluded.source_modified_at>=existing.source_modified_at and excluded.checked_at>existing.checked_at
   and not(excluded.source_modified_at=existing.source_modified_at and existing.status in ('ok','partial') and excluded.status in ('failed','unsupported'));
  get diagnostics n=row_count; total:=total+n;
 end loop;
 return pg_catalog.jsonb_build_object('saved',total);
end $$;
revoke all on function public.ingest_workdesk_file_summaries(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_workdesk_file_summaries(uuid,jsonb) to service_role;
alter publication supabase_realtime add table public.file_summaries;

;

-- SOURCE: collection-results.sql
-- Collector-only completion evidence. No tasks, messages, credentials, or source copies.

create table public.source_collection_results (
 workspace_id uuid not null references public.workspaces(id), source_id text not null,
 run_id text not null, checked_at timestamptz not null,
 status text not null check(status in ('ok','partial','failed')),
 scope jsonb not null, checks jsonb not null, missing jsonb not null,
 detail text not null default '', feed_batch_id text, file_batch_id text,
 verified_at timestamptz, last_success_at timestamptz,
 next_expected_at timestamptz, schedule_verified_at timestamptz,
 fingerprint text not null, recorded_at timestamptz not null default now(),
 primary key(workspace_id,source_id),
 check(jsonb_typeof(scope)='object' and jsonb_typeof(checks)='object' and jsonb_typeof(missing)='array'),
 check(length(detail)<=6000)
);
alter table public.source_collection_results enable row level security;
revoke all on public.source_collection_results from public,anon,authenticated;
grant select on public.source_collection_results to authenticated;
grant all on public.source_collection_results to service_role;
create policy owner_read on public.source_collection_results for select to authenticated
 using(workdesk_private.can_access(workspace_id));

create function public.record_workdesk_collection(p_workspace uuid,p_report jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare sid text:=p_report->>'source_id'; stamp timestamptz; fp text; previous public.source_collection_results;
 required text[]; key text; c jsonb; expected integer; checked integer; all_done boolean:=true;
 feed_id text:=nullif(p_report->>'feed_batch_id',''); file_id text:=nullif(p_report->>'file_batch_id','');
 source jsonb; stored boolean:=false; result_status text:=p_report->>'status'; due timestamptz; calendar_at timestamptz;
begin
 required:=case sid
  when 'dooray-mail' then array['listing','content','attachments']
  when 'dooray-favorites' then array['favorites','history','attachments']
  when 'dooray-calendar' then array['listing','details']
  when 'google-primary' then array['listing']
  when 'google-secondary' then array['listing']
  when 'onedrive-files' then array['modified_search','created_search','folder_listing','metadata'] end;
 if required is null or p_report->>'schema_version' is distinct from '1'
  or result_status is null or result_status not in ('ok','partial','failed')
  or coalesce(length(p_report->>'run_id'),0) not between 1 and 200
  or coalesce(p_report->>'checked_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or jsonb_typeof(p_report->'scope') is distinct from 'object'
  or coalesce(length(trim(p_report#>>'{scope,description}')),0)=0
  or jsonb_typeof(p_report#>'{scope,limitations}') is distinct from 'array'
  or jsonb_typeof(p_report->'checks') is distinct from 'object'
  or jsonb_typeof(p_report->'missing') is distinct from 'array'
  or coalesce(length(trim(p_report->>'detail')),0)=0 then raise exception 'Invalid collection evidence'; end if;
 stamp:=(p_report->>'checked_at')::timestamptz;
 if stamp>now()+interval '5 minutes' then raise exception 'Future collection time'; end if;
 if coalesce(p_report#>>'{scope,from}','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or coalesce(p_report#>>'{scope,to}','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or (p_report#>>'{scope,from}')::timestamptz>=(p_report#>>'{scope,to}')::timestamptz
  then raise exception 'Collection range required'; end if;
 foreach key in array required loop
  c:=p_report->'checks'->key;
  if c is null then all_done:=false;continue;end if;
  if jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(c->'complete') is distinct from 'boolean'
   or coalesce(c->>'expected','') !~ '^[0-9]+$' or coalesce(c->>'checked','') !~ '^[0-9]+$'
   then raise exception 'Invalid check counts: %',key;end if;
  expected:=(c->>'expected')::int; checked:=(c->>'checked')::int;
  if checked>expected then raise exception 'Checked exceeds expected';end if;
  if not(c->>'complete')::boolean or checked<>expected then all_done:=false;end if;
 end loop;
 for c in select value from jsonb_array_elements(p_report->'missing') loop
  if coalesce(length(trim(c->>'target')),0)=0 or coalesce(length(trim(c->>'reason')),0)=0
   then raise exception 'Missing item needs target and reason';end if;
 end loop;
 if nullif(p_report->>'next_expected_at','') is not null then
  if coalesce(p_report->>'next_expected_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
   or coalesce(p_report->>'schedule_verified_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
   then raise exception 'Verified holiday calendar and timezone required';end if;
  due:=(p_report->>'next_expected_at')::timestamptz;calendar_at:=(p_report->>'schedule_verified_at')::timestamptz;
  if due<=stamp or extract(isodow from due at time zone 'Asia/Seoul') in (6,7)
   or (due at time zone 'Asia/Seoul')::time<>'13:00'::time or calendar_at>now()+interval '5 minutes'
   then raise exception 'Invalid next scheduled check';end if;
 end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 if not found then raise exception 'Workspace not found';end if;
 fp:=md5(p_report::text);
 select * into previous from public.source_collection_results where workspace_id=p_workspace and source_id=sid;
 if found then
  if stamp<previous.checked_at then return jsonb_build_object('ignored','older observation');end if;
  if stamp=previous.checked_at then
   if previous.fingerprint<>fp then raise exception 'Observation content conflict';end if;
   return jsonb_build_object('duplicate',true);end if;
 end if;
 if sid='onedrive-files' and file_id is not null then
  select true into stored from public.file_sync_runs f where f.workspace_id=p_workspace and f.id=file_id
   and f.checked_at=stamp and (result_status='failed' or f.status<>'failed');
 elsif sid<>'onedrive-files' and feed_id is not null then
  select s into source from public.sync_runs r cross join lateral jsonb_array_elements(r.sources) s
   where r.workspace_id=p_workspace and r.id=feed_id and s->>'id'=sid
   and (s->>'checked_at')::timestamptz=stamp and s->>'status' in ('ok','partial','failed') limit 1;
  stored:=source is not null and (result_status='failed' or source->>'status'<>'failed');
 end if;
 if result_status='ok' and (not all_done or jsonb_array_length(p_report->'missing')<>0 or not coalesce(stored,false))
  then raise exception 'Completion requires all checks and a persisted matching feed';end if;
 if result_status<>'ok' and jsonb_array_length(p_report->'missing')=0 then raise exception 'Incomplete collection needs a reason';end if;
 insert into public.source_collection_results as current(workspace_id,source_id,run_id,checked_at,status,scope,checks,missing,detail,
  feed_batch_id,file_batch_id,verified_at,last_success_at,next_expected_at,schedule_verified_at,fingerprint)
 values(p_workspace,sid,p_report->>'run_id',stamp,result_status,p_report->'scope',p_report->'checks',p_report->'missing',p_report->>'detail',
  feed_id,file_id,case when stored then now() end,case when result_status='ok' then stamp else previous.last_success_at end,due,calendar_at,fp)
 on conflict(workspace_id,source_id) do update set
  run_id=excluded.run_id,checked_at=excluded.checked_at,status=excluded.status,scope=excluded.scope,checks=excluded.checks,missing=excluded.missing,
  detail=excluded.detail,feed_batch_id=excluded.feed_batch_id,file_batch_id=excluded.file_batch_id,verified_at=excluded.verified_at,
  last_success_at=excluded.last_success_at,next_expected_at=excluded.next_expected_at,schedule_verified_at=excluded.schedule_verified_at,
  fingerprint=excluded.fingerprint,recorded_at=now();
 return jsonb_build_object('saved',true,'status',result_status,'stored',coalesce(stored,false));
end $$;
revoke all on function public.record_workdesk_collection(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_workdesk_collection(uuid,jsonb) to service_role;
alter publication supabase_realtime add table public.source_collection_results;

;

-- SOURCE: briefing-visibility.sql
-- Per-workspace presentation preferences. Does not modify tasks or source summaries.

create table public.briefing_dismissals (
 workspace_id uuid not null references public.workspaces(id),
 line_text text not null check (char_length(line_text) between 1 and 8000 and line_text=btrim(line_text)),
 line_key text generated always as (md5(line_text)) stored,
 hidden_at timestamptz,
 updated_at timestamptz not null default now(),
 primary key(workspace_id,line_key)
);
alter table public.briefing_dismissals enable row level security;
revoke all on public.briefing_dismissals from public,anon,authenticated;
grant select,insert,update on public.briefing_dismissals to authenticated;
grant all on public.briefing_dismissals to service_role;
create policy owner_read on public.briefing_dismissals for select to authenticated
 using (workdesk_private.can_access(workspace_id));
create policy owner_insert on public.briefing_dismissals for insert to authenticated
 with check (workdesk_private.can_access(workspace_id));
create policy owner_update on public.briefing_dismissals for update to authenticated
 using (workdesk_private.can_access(workspace_id)) with check (workdesk_private.can_access(workspace_id));

create function public.set_workdesk_briefing_hidden(p_workspace uuid,p_line text,p_hidden boolean)
returns public.briefing_dismissals language plpgsql security invoker set search_path='' as $$
declare item public.briefing_dismissals; clean text:=btrim(p_line);
begin
 if not workdesk_private.can_access(p_workspace) then raise exception 'Workspace not available'; end if;
 if p_hidden is null or clean is null or char_length(clean) not between 1 and 8000
 then raise exception 'Valid briefing text and visibility required'; end if;
 if p_hidden then
  insert into public.briefing_dismissals as existing(workspace_id,line_text,hidden_at,updated_at)
  values(p_workspace,clean,now(),now())
  on conflict(workspace_id,line_key) do update
   set hidden_at=coalesce(existing.hidden_at,excluded.hidden_at),updated_at=excluded.updated_at
   where existing.line_text=excluded.line_text
  returning * into item;
 else
  update public.briefing_dismissals set hidden_at=null,updated_at=now()
   where workspace_id=p_workspace and line_key=md5(clean) and line_text=clean
   returning * into item;
 end if;
 if not found then raise exception 'Briefing preference not available'; end if;
 return item;
end $$;
revoke all on function public.set_workdesk_briefing_hidden(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.set_workdesk_briefing_hidden(uuid,text,boolean) to authenticated;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
  select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='briefing_dismissals')
 then alter publication supabase_realtime add table public.briefing_dismissals;end if;
end $$;

;

-- SOURCE: item-visibility.sql
-- Owner-only visibility for upcoming-event and recent-file panels.
-- Original calendar events, overrides, file metadata and summaries are untouched.

create table public.workdesk_item_visibility (
 workspace_id uuid not null references public.workspaces(id),
 kind text not null check(kind in ('agenda','file')),
 drive_id text not null default '',
 item_id text not null check(length(item_id)>0),
 label text not null,
 hidden_at timestamptz,
 updated_at timestamptz not null default now(),
 primary key(workspace_id,kind,drive_id,item_id),
 check((kind='agenda' and drive_id='') or (kind='file' and length(drive_id)>0)),
 check(octet_length(drive_id)+octet_length(item_id)<=2000)
);
alter table public.workdesk_item_visibility enable row level security;
revoke all on public.workdesk_item_visibility from public,anon,authenticated;
grant select,insert,update on public.workdesk_item_visibility to authenticated;
grant all on public.workdesk_item_visibility to service_role;
create policy owner_read on public.workdesk_item_visibility for select to authenticated
 using(workdesk_private.can_access(workspace_id));
create policy owner_insert on public.workdesk_item_visibility for insert to authenticated
 with check(workdesk_private.can_access(workspace_id));
create policy owner_update on public.workdesk_item_visibility for update to authenticated
 using(workdesk_private.can_access(workspace_id)) with check(workdesk_private.can_access(workspace_id));

create function public.set_workdesk_item_hidden(p_workspace uuid,p_kind text,p_drive_id text,p_item_id text,p_hidden boolean)
returns public.workdesk_item_visibility language plpgsql security invoker set search_path='' as $$
declare item public.workdesk_item_visibility; source_label text;
begin
 if not workdesk_private.can_access(p_workspace) then raise exception 'Workspace not available';end if;
 if p_hidden is null or p_kind is null or p_kind not in ('agenda','file') or p_drive_id is null
 or coalesce(length(p_item_id),0)=0 or octet_length(p_drive_id)+octet_length(p_item_id)>2000
 or (p_kind='agenda' and p_drive_id<>'') or (p_kind='file' and p_drive_id='')
 then raise exception 'Invalid item identity or visibility';end if;
 if p_hidden then
  if p_kind='agenda' then
   select title into source_label from public.calendar_events where workspace_id=p_workspace and id=p_item_id;
  else
   select name into source_label from public.file_changes
    where workspace_id=p_workspace and drive_id=p_drive_id and item_id=p_item_id
    order by modified_at_source desc,changed_at desc,id desc limit 1;
  end if;
  if not found then raise exception 'Source item not available';end if;
  insert into public.workdesk_item_visibility as existing(workspace_id,kind,drive_id,item_id,label,hidden_at,updated_at)
  values(p_workspace,p_kind,p_drive_id,p_item_id,source_label,now(),now())
  on conflict(workspace_id,kind,drive_id,item_id) do update
   set label=excluded.label,hidden_at=coalesce(existing.hidden_at,excluded.hidden_at),updated_at=excluded.updated_at
  returning * into item;
 else
  update public.workdesk_item_visibility set hidden_at=null,updated_at=now()
   where workspace_id=p_workspace and kind=p_kind and drive_id=p_drive_id and item_id=p_item_id
   returning * into item;
  if not found then raise exception 'Item preference not available';end if;
 end if;
 return item;
end $$;
revoke all on function public.set_workdesk_item_hidden(uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.set_workdesk_item_hidden(uuid,text,text,text,boolean) to authenticated;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
  select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='workdesk_item_visibility')
 then alter publication supabase_realtime add table public.workdesk_item_visibility;end if;
end $$;

;

-- SOURCE: onedrive-scoped-completion.sql
-- Approved designated-scope completion. No rows or ACLs are changed.
CREATE OR REPLACE FUNCTION public.record_workdesk_collection(p_workspace uuid, p_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare sid text:=p_report->>'source_id'; stamp timestamptz; fp text; previous public.source_collection_results;
 required text[]; key text; c jsonb; expected integer; checked integer; all_done boolean:=true;
 feed_id text:=nullif(p_report->>'feed_batch_id',''); file_id text:=nullif(p_report->>'file_batch_id','');
 source jsonb; stored boolean:=false; result_status text:=p_report->>'status'; due timestamptz; calendar_at timestamptz;
begin
 required:=case sid
  when 'dooray-mail' then array['listing','content','attachments']
  when 'dooray-favorites' then array['favorites','history','attachments']
  when 'dooray-calendar' then array['listing','details']
  when 'google-primary' then array['listing']
  when 'google-secondary' then array['listing']
  when 'onedrive-files' then array['folder_listing','metadata'] end;
 if required is null or p_report->>'schema_version' is distinct from '1'
  or result_status is null or result_status not in ('ok','partial','failed')
  or coalesce(length(p_report->>'run_id'),0) not between 1 and 200
  or coalesce(p_report->>'checked_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or jsonb_typeof(p_report->'scope') is distinct from 'object'
  or coalesce(length(trim(p_report#>>'{scope,description}')),0)=0
  or jsonb_typeof(p_report#>'{scope,limitations}') is distinct from 'array'
  or jsonb_typeof(p_report->'checks') is distinct from 'object'
  or jsonb_typeof(p_report->'missing') is distinct from 'array'
  or coalesce(length(trim(p_report->>'detail')),0)=0 then raise exception 'Invalid collection evidence'; end if;
 stamp:=(p_report->>'checked_at')::timestamptz;
 if stamp>now()+interval '5 minutes' then raise exception 'Future collection time'; end if;
 if coalesce(p_report#>>'{scope,from}','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or coalesce(p_report#>>'{scope,to}','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or (p_report#>>'{scope,from}')::timestamptz>=(p_report#>>'{scope,to}')::timestamptz
  then raise exception 'Collection range required'; end if;
 foreach key in array required loop
  c:=p_report->'checks'->key;
  if c is null then all_done:=false;continue;end if;
  if jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(c->'complete') is distinct from 'boolean'
   or coalesce(c->>'expected','') !~ '^[0-9]+$' or coalesce(c->>'checked','') !~ '^[0-9]+$'
   then raise exception 'Invalid check counts: %',key;end if;
  expected:=(c->>'expected')::int; checked:=(c->>'checked')::int;
  if checked>expected then raise exception 'Checked exceeds expected';end if;
  if not(c->>'complete')::boolean or checked<>expected then all_done:=false;end if;
 end loop;
 for c in select value from jsonb_array_elements(p_report->'missing') loop
  if coalesce(length(trim(c->>'target')),0)=0 or coalesce(length(trim(c->>'reason')),0)=0
   then raise exception 'Missing item needs target and reason';end if;
 end loop;
 if nullif(p_report->>'next_expected_at','') is not null then
  if coalesce(p_report->>'next_expected_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
   or coalesce(p_report->>'schedule_verified_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
   then raise exception 'Verified holiday calendar and timezone required';end if;
  due:=(p_report->>'next_expected_at')::timestamptz;calendar_at:=(p_report->>'schedule_verified_at')::timestamptz;
  if due<=stamp or extract(isodow from due at time zone 'Asia/Seoul') in (6,7)
   or (due at time zone 'Asia/Seoul')::time<>'13:00'::time or calendar_at>now()+interval '5 minutes'
   then raise exception 'Invalid next scheduled check';end if;
 end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 if not found then raise exception 'Workspace not found';end if;
 fp:=md5(p_report::text);
 select * into previous from public.source_collection_results where workspace_id=p_workspace and source_id=sid;
 if found then
  if stamp<previous.checked_at then return jsonb_build_object('ignored','older observation');end if;
  if stamp=previous.checked_at then
   if previous.fingerprint<>fp then raise exception 'Observation content conflict';end if;
   return jsonb_build_object('duplicate',true);end if;
 end if;
 if sid='onedrive-files' and file_id is not null then
  select true into stored from public.file_sync_runs f where f.workspace_id=p_workspace and f.id=file_id
   and f.checked_at=stamp and (result_status='failed' or f.status<>'failed');
 elsif sid<>'onedrive-files' and feed_id is not null then
  select s into source from public.sync_runs r cross join lateral jsonb_array_elements(r.sources) s
   where r.workspace_id=p_workspace and r.id=feed_id and s->>'id'=sid
   and (s->>'checked_at')::timestamptz=stamp and s->>'status' in ('ok','partial','failed') limit 1;
  stored:=source is not null and (result_status='failed' or source->>'status'<>'failed');
 end if;
 if result_status='ok' and (not all_done or jsonb_array_length(p_report->'missing')<>0 or not coalesce(stored,false))
  then raise exception 'Completion requires all checks and a persisted matching feed';end if;
 if result_status<>'ok' and jsonb_array_length(p_report->'missing')=0 then raise exception 'Incomplete collection needs a reason';end if;
 insert into public.source_collection_results as current(workspace_id,source_id,run_id,checked_at,status,scope,checks,missing,detail,
  feed_batch_id,file_batch_id,verified_at,last_success_at,next_expected_at,schedule_verified_at,fingerprint)
 values(p_workspace,sid,p_report->>'run_id',stamp,result_status,p_report->'scope',p_report->'checks',p_report->'missing',p_report->>'detail',
  feed_id,file_id,case when stored then now() end,case when result_status='ok' then stamp else previous.last_success_at end,due,calendar_at,fp)
 on conflict(workspace_id,source_id) do update set
  run_id=excluded.run_id,checked_at=excluded.checked_at,status=excluded.status,scope=excluded.scope,checks=excluded.checks,missing=excluded.missing,
  detail=excluded.detail,feed_batch_id=excluded.feed_batch_id,file_batch_id=excluded.file_batch_id,verified_at=excluded.verified_at,
  last_success_at=excluded.last_success_at,next_expected_at=excluded.next_expected_at,schedule_verified_at=excluded.schedule_verified_at,
  fingerprint=excluded.fingerprint,recorded_at=now();
 return jsonb_build_object('saved',true,'status',result_status,'stored',coalesce(stored,false));
end $function$


;

-- SOURCE: dooray-body-completion.sql
-- Dooray body coverage determines completion; attachments are best-effort evidence.
-- No historical rows, user tasks, ACLs, or other source requirements are changed.
CREATE OR REPLACE FUNCTION public.record_workdesk_collection(p_workspace uuid, p_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare sid text:=p_report->>'source_id'; stamp timestamptz; fp text; previous public.source_collection_results;
 required text[]; key text; c jsonb; expected integer; checked integer; all_done boolean:=true;
 feed_id text:=nullif(p_report->>'feed_batch_id',''); file_id text:=nullif(p_report->>'file_batch_id','');
 source jsonb; stored boolean:=false; result_status text:=p_report->>'status'; due timestamptz; calendar_at timestamptz;
begin
 required:=case sid
  when 'dooray-mail' then array['listing','content']
  when 'dooray-favorites' then array['favorites','history']
  when 'dooray-calendar' then array['listing','details']
  when 'google-primary' then array['listing']
  when 'google-secondary' then array['listing']
  when 'onedrive-files' then array['folder_listing','metadata'] end;
 if required is null or p_report->>'schema_version' is distinct from '1'
  or result_status is null or result_status not in ('ok','partial','failed')
  or coalesce(length(p_report->>'run_id'),0) not between 1 and 200
  or coalesce(p_report->>'checked_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or jsonb_typeof(p_report->'scope') is distinct from 'object'
  or coalesce(length(trim(p_report#>>'{scope,description}')),0)=0
  or jsonb_typeof(p_report#>'{scope,limitations}') is distinct from 'array'
  or jsonb_typeof(p_report->'checks') is distinct from 'object'
  or jsonb_typeof(p_report->'missing') is distinct from 'array'
  or coalesce(length(trim(p_report->>'detail')),0)=0 then raise exception 'Invalid collection evidence'; end if;
 stamp:=(p_report->>'checked_at')::timestamptz;
 if stamp>now()+interval '5 minutes' then raise exception 'Future collection time'; end if;
 if coalesce(p_report#>>'{scope,from}','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or coalesce(p_report#>>'{scope,to}','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
  or (p_report#>>'{scope,from}')::timestamptz>=(p_report#>>'{scope,to}')::timestamptz
  then raise exception 'Collection range required'; end if;
 foreach key in array required loop
  c:=p_report->'checks'->key;
  if c is null then all_done:=false;continue;end if;
  if jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(c->'complete') is distinct from 'boolean'
   or coalesce(c->>'expected','') !~ '^[0-9]+$' or coalesce(c->>'checked','') !~ '^[0-9]+$'
   then raise exception 'Invalid check counts: %',key;end if;
  expected:=(c->>'expected')::int; checked:=(c->>'checked')::int;
  if checked>expected then raise exception 'Checked exceeds expected';end if;
  if not(c->>'complete')::boolean or checked<>expected then all_done:=false;end if;
 end loop;
 for c in select value from jsonb_array_elements(p_report->'missing') loop
  if coalesce(length(trim(c->>'target')),0)=0 or coalesce(length(trim(c->>'reason')),0)=0
   then raise exception 'Missing item needs target and reason';end if;
 end loop;
 if nullif(p_report->>'next_expected_at','') is not null then
  if coalesce(p_report->>'next_expected_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
   or coalesce(p_report->>'schedule_verified_at','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
   then raise exception 'Verified holiday calendar and timezone required';end if;
  due:=(p_report->>'next_expected_at')::timestamptz;calendar_at:=(p_report->>'schedule_verified_at')::timestamptz;
  if due<=stamp or extract(isodow from due at time zone 'Asia/Seoul') in (6,7)
   or (due at time zone 'Asia/Seoul')::time<>'13:00'::time or calendar_at>now()+interval '5 minutes'
   then raise exception 'Invalid next scheduled check';end if;
 end if;
 perform 1 from public.workspaces where id=p_workspace for update;
 if not found then raise exception 'Workspace not found';end if;
 fp:=md5(p_report::text);
 select * into previous from public.source_collection_results where workspace_id=p_workspace and source_id=sid;
 if found then
  if stamp<previous.checked_at then return jsonb_build_object('ignored','older observation');end if;
  if stamp=previous.checked_at then
   if previous.fingerprint<>fp then raise exception 'Observation content conflict';end if;
   return jsonb_build_object('duplicate',true);end if;
 end if;
 if sid='onedrive-files' and file_id is not null then
  select true into stored from public.file_sync_runs f where f.workspace_id=p_workspace and f.id=file_id
   and f.checked_at=stamp and (result_status='failed' or f.status<>'failed');
 elsif sid<>'onedrive-files' and feed_id is not null then
  select s into source from public.sync_runs r cross join lateral jsonb_array_elements(r.sources) s
   where r.workspace_id=p_workspace and r.id=feed_id and s->>'id'=sid
   and (s->>'checked_at')::timestamptz=stamp and s->>'status' in ('ok','partial','failed') limit 1;
  stored:=source is not null and (result_status='failed' or source->>'status'<>'failed');
 end if;
 if result_status='ok' and (not all_done or jsonb_array_length(p_report->'missing')<>0 or not coalesce(stored,false))
  then raise exception 'Completion requires all checks and a persisted matching feed';end if;
 if result_status<>'ok' and jsonb_array_length(p_report->'missing')=0 then raise exception 'Incomplete collection needs a reason';end if;
 insert into public.source_collection_results as current(workspace_id,source_id,run_id,checked_at,status,scope,checks,missing,detail,
  feed_batch_id,file_batch_id,verified_at,last_success_at,next_expected_at,schedule_verified_at,fingerprint)
 values(p_workspace,sid,p_report->>'run_id',stamp,result_status,p_report->'scope',p_report->'checks',p_report->'missing',p_report->>'detail',
  feed_id,file_id,case when stored then now() end,case when result_status='ok' then stamp else previous.last_success_at end,due,calendar_at,fp)
 on conflict(workspace_id,source_id) do update set
  run_id=excluded.run_id,checked_at=excluded.checked_at,status=excluded.status,scope=excluded.scope,checks=excluded.checks,missing=excluded.missing,
  detail=excluded.detail,feed_batch_id=excluded.feed_batch_id,file_batch_id=excluded.file_batch_id,verified_at=excluded.verified_at,
  last_success_at=excluded.last_success_at,next_expected_at=excluded.next_expected_at,schedule_verified_at=excluded.schedule_verified_at,
  fingerprint=excluded.fingerprint,recorded_at=now();
 return jsonb_build_object('saved',true,'status',result_status,'stored',coalesce(stored,false));
end $function$


;

-- SOURCE: assignment-followthrough.sql
-- Schema-only external follow-through ledger; no operational data copied.
create table public.workdesk_followthrough (
 id uuid not null default gen_random_uuid(),
 workspace_id uuid not null,
 message_id uuid not null,
 task_id text,
 kind text not null,
 target_key text not null,
 instruction text not null,
 authorization_scope text not null,
 due_at timestamp with time zone,
 state text not null default 'queued'::text,
 blocked_reason text not null default ''::text,
 evidence_ref text not null default ''::text,
 evidence_summary text not null default ''::text,
 verified_at timestamp with time zone,
 revision bigint not null default 1,
 created_at timestamp with time zone not null default now(),
 updated_at timestamp with time zone not null default now(),
 constraint workdesk_followthrough_authorization_scope_check CHECK (((length(TRIM(BOTH FROM authorization_scope)) >= 1) AND (length(TRIM(BOTH FROM authorization_scope)) <= 6000))),
 constraint workdesk_followthrough_check CHECK (((state <> 'verified'::text) OR ((verified_at IS NOT NULL) AND (length(TRIM(BOTH FROM evidence_ref)) > 0) AND (length(TRIM(BOTH FROM evidence_summary)) > 0)))),
 constraint workdesk_followthrough_check1 CHECK (((state <> 'blocked'::text) OR (length(TRIM(BOTH FROM blocked_reason)) > 0))),
 constraint workdesk_followthrough_instruction_check CHECK (((length(TRIM(BOTH FROM instruction)) >= 1) AND (length(TRIM(BOTH FROM instruction)) <= 6000))),
 constraint workdesk_followthrough_kind_check CHECK ((kind = ANY (ARRAY['report'::text, 'meeting'::text, 'notice'::text]))),
 constraint workdesk_followthrough_message_id_fkey FOREIGN KEY (message_id) REFERENCES workdesk_messages(id),
 constraint workdesk_followthrough_pkey PRIMARY KEY (id),
 constraint workdesk_followthrough_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'drafted'::text, 'blocked'::text, 'verified'::text, 'cancelled'::text]))),
 constraint workdesk_followthrough_target_key_check CHECK (((length(TRIM(BOTH FROM target_key)) >= 1) AND (length(TRIM(BOTH FROM target_key)) <= 500))),
 constraint workdesk_followthrough_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id),
 constraint workdesk_followthrough_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
 constraint workdesk_followthrough_workspace_id_message_id_kind_target__key UNIQUE (workspace_id, message_id, kind, target_key)
);
alter table public.workdesk_followthrough enable row level security;
revoke all on public.workdesk_followthrough from public,anon,authenticated;
grant select on public.workdesk_followthrough to authenticated;
grant all on public.workdesk_followthrough to service_role;
create policy owner_read on public.workdesk_followthrough for select to authenticated using(workdesk_private.can_access(workspace_id));
CREATE INDEX followthrough_pending ON public.workdesk_followthrough USING btree (workspace_id, due_at) WHERE (state <> ALL (ARRAY['verified'::text, 'cancelled'::text]));

;

-- SOURCE: assignment-bootstrap.sql
-- Assignment-only additions. Run ONLY via generated assignment-install.sql on a fresh project.
create table workdesk_private.assignment_environment (
 singleton boolean primary key default true check(singleton),
 environment text not null check(environment='assignment'),
 schema_version integer not null,
 created_at timestamptz not null default now()
);
insert into workdesk_private.assignment_environment(singleton,environment,schema_version) values(true,'assignment',1);
revoke all on workdesk_private.assignment_environment from public,anon,authenticated;
create table workdesk_private.assignment_accounts (
 user_id uuid primary key references auth.users(id) on delete cascade,
 workspace_id uuid not null unique references public.workspaces(id),
 created_at timestamptz not null default now()
);
alter table workdesk_private.assignment_accounts enable row level security;
alter table workdesk_private.assignment_environment enable row level security;
revoke all on workdesk_private.assignment_accounts from public,anon,authenticated;

-- UID remains the ownership authority even if email changes or is later reused.
create or replace function workdesk_private.can_access(w uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null
 and coalesce((auth.jwt()->>'is_anonymous')::boolean,false)=false
 and (nullif(auth.jwt()->>'client_id','') is null or (auth.jwt()->>'assignment_environment'='assignment' and coalesce(auth.jwt()->'assignment_scopes','[]'::jsonb) ? 'workboard:read'))
 and exists(select 1 from workdesk_private.assignment_accounts a where a.workspace_id=w and a.user_id=auth.uid());
$$;
revoke all on function workdesk_private.can_access(uuid) from public,anon;
grant execute on function workdesk_private.can_access(uuid) to authenticated;

create function public.assignment_environment() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('environment',environment,'schema_version',schema_version)
 from workdesk_private.assignment_environment where singleton;
$$;
revoke all on function public.assignment_environment() from public,anon;
grant execute on function public.assignment_environment() to authenticated;

create function public.ensure_assignment_workspace() returns public.workspaces
language plpgsql security definer set search_path='' as $$
declare v_user_id uuid:=auth.uid(); verified_email text; result public.workspaces;
begin
 if v_user_id is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Authenticated verified account required'; end if;
 if nullif(auth.jwt()->>'client_id','') is not null and not coalesce(auth.jwt()->>'assignment_environment'='assignment' and (auth.jwt()->'assignment_scopes') ? 'workboard:read',false) then raise exception 'Assignment OAuth read grant required'; end if;
 if not exists(select 1 from workdesk_private.assignment_environment where singleton and environment='assignment') then raise exception 'Assignment environment required'; end if;
 select lower(u.email) into verified_email from auth.users u where u.id=v_user_id and u.email_confirmed_at is not null;
 if verified_email is null or length(verified_email)=0 then raise exception 'Verified email required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text,89231));
 select w.* into result from public.workspaces w join workdesk_private.assignment_accounts a on a.workspace_id=w.id where a.user_id=v_user_id;
 if found then return result; end if;
 insert into public.workspaces(name) values('과제용 개인 업무보드') returning * into result;
 insert into workdesk_private.assignment_accounts(user_id,workspace_id) values(v_user_id,result.id);
 insert into workdesk_private.access(workspace_id,allowed_email) values(result.id,verified_email);
 return result;
end $$;
revoke all on function public.ensure_assignment_workspace() from public,anon;
grant execute on function public.ensure_assignment_workspace() to authenticated;

create function workdesk_private.assignment_workspace() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'Authenticated account required'; end if;
 if nullif(auth.jwt()->>'client_id','') is not null and not coalesce(auth.jwt()->>'assignment_environment'='assignment' and (auth.jwt()->'assignment_scopes') ? 'workboard:write',false) then raise exception 'Assignment OAuth write grant required'; end if;
 select workspace_id into result from workdesk_private.assignment_accounts where user_id=auth.uid();
 if result is null then raise exception 'Create assignment workspace first'; end if;
 return result;
end $$;
revoke all on function workdesk_private.assignment_workspace() from public,anon,authenticated;

-- All source identifiers are scoped, including IDs whose source systems reuse short names.
create function workdesk_private.assignment_id(w uuid, raw text) returns text
language plpgsql immutable set search_path='' as $$
declare prefix text:='assignment:'||w::text||':';
begin
 if raw is null or length(trim(raw))=0 or length(raw)>500 then raise exception 'Invalid source identity'; end if;
 if left(raw,length(prefix))=prefix then return raw; end if;
 return prefix||raw;
end $$;
revoke all on function workdesk_private.assignment_id(uuid,text) from public,anon,authenticated;

create function public.assignment_ingest_feed(p_feed jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w uuid:=workdesk_private.assignment_workspace(); f jsonb:=p_feed; item jsonb; items jsonb; field text;
begin
 if jsonb_typeof(f) is distinct from 'object' or pg_column_size(f)>1048576 then raise exception 'Invalid or oversized feed'; end if;
 if jsonb_typeof(f->'tasks') is distinct from 'array' or jsonb_typeof(coalesce(f->'events','[]')) is distinct from 'array' then raise exception 'Tasks and events arrays required'; end if;
 if jsonb_array_length(f->'tasks')>200 or jsonb_array_length(coalesce(f->'events','[]'))>200 then raise exception 'Maximum 200 items per collection'; end if;
 if nullif(f->>'generated_at','') is null or (f->>'generated_at')::timestamptz>now()+interval '5 minutes' then raise exception 'Valid collection timestamp required'; end if;
 f:=jsonb_set(f,'{batch_id}',to_jsonb(workdesk_private.assignment_id(w,f->>'batch_id')));
 foreach field in array array['tasks','events'] loop
  items:='[]';
  for item in select value from jsonb_array_elements(coalesce(f->field,'[]')) loop
   item:=jsonb_set(item,'{id}',to_jsonb(workdesk_private.assignment_id(w,item->>'id')));
   items:=items||jsonb_build_array(item);
  end loop;
  f:=jsonb_set(f,array[field],items);
 end loop;
 return public.ingest_workdesk_feed(w,f);
end $$;

create function public.assignment_ingest_files(p_feed jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w uuid:=workdesk_private.assignment_workspace(); f jsonb:=p_feed;
begin
 if jsonb_typeof(f) is distinct from 'object' or pg_column_size(f)>1048576 then raise exception 'Invalid or oversized file feed'; end if;
 f:=jsonb_set(f,'{batch_id}',to_jsonb(workdesk_private.assignment_id(w,f->>'batch_id')));
 return public.ingest_workdesk_files(w,f);
end $$;
create function public.assignment_ingest_file_summaries(p_feed jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if jsonb_typeof(p_feed) is distinct from 'object' or pg_column_size(p_feed)>1048576 then raise exception 'Invalid or oversized summaries'; end if;
 return public.ingest_workdesk_file_summaries(workdesk_private.assignment_workspace(),p_feed);
end $$;
create function public.assignment_ingest_links(p_feed jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if jsonb_typeof(p_feed) is distinct from 'object' or pg_column_size(p_feed)>1048576 then raise exception 'Invalid or oversized links'; end if;
 return public.ingest_workdesk_links(workdesk_private.assignment_workspace(),p_feed);
end $$;
create function public.assignment_record_collection(p_report jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w uuid:=workdesk_private.assignment_workspace(); report jsonb:=p_report; field text;
begin
 if jsonb_typeof(report) is distinct from 'object' or pg_column_size(report)>1048576 then raise exception 'Invalid or oversized report'; end if;
 foreach field in array array['feed_batch_id','file_batch_id'] loop
  if nullif(report->>field,'') is not null then report:=jsonb_set(report,array[field],to_jsonb(workdesk_private.assignment_id(w,report->>field))); end if;
 end loop;
 return public.record_workdesk_collection(w,report);
end $$;
create function public.assignment_resolve_message(p_message uuid,p_reply text,p_actions jsonb,p_clarification boolean default false)
returns public.workdesk_messages language plpgsql security definer set search_path='' as $$
declare w uuid:=workdesk_private.assignment_workspace();
begin
 if not exists(select 1 from public.workdesk_messages where id=p_message and workspace_id=w) then raise exception 'Message not available'; end if;
 return public.resolve_workdesk_message(p_message,p_reply,p_actions,p_clarification);
end $$;

do $$ declare signature text; begin
 foreach signature in array array[
 'assignment_ingest_feed(jsonb)','assignment_ingest_files(jsonb)',
 'assignment_ingest_file_summaries(jsonb)','assignment_ingest_links(jsonb)',
 'assignment_record_collection(jsonb)','assignment_resolve_message(uuid,text,jsonb,boolean)'] loop
 execute 'revoke all on function public.'||signature||' from public,anon,authenticated';
 execute 'grant execute on function public.'||signature||' to authenticated';
 end loop;
end $$;
notify pgrst,'reload schema';

-- Scope enforcement remains in the database even when a client bypasses the MCP router.
create function workdesk_private.assignment_write_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if nullif(auth.jwt()->>'client_id','') is not null and not coalesce(
  auth.jwt()->>'assignment_environment'='assignment' and (auth.jwt()->'assignment_scopes') ? 'workboard:write',false)
 then raise exception 'Assignment OAuth write grant required'; end if;
 if TG_OP='DELETE' then return old; else return new; end if;
end $$;
revoke all on function workdesk_private.assignment_write_guard() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['workspaces','tasks','task_history','calendar_events','sync_runs','workspace_links','workdesk_messages','calendar_overrides','file_changes','file_sync_runs','file_summaries','source_collection_results','briefing_dismissals','workdesk_item_visibility','workdesk_followthrough'] loop
 execute format('create trigger assignment_scope_write before insert or update or delete on public.%I for each row execute function workdesk_private.assignment_write_guard()',t);
 end loop;
end $$;

;
commit;
