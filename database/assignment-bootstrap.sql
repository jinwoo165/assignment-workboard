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
