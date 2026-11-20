-- Apply only to the NEW assignment project after assignment-bootstrap.sql.
-- Activating this hook is a separate Supabase Dashboard step. No clients are enabled by default.
begin;
do $$ begin
 if to_regclass('workdesk_private.assignment_environment') is null then raise exception 'Assignment marker required'; end if;
 if not exists(select 1 from workdesk_private.assignment_environment where environment='assignment' and schema_version=1) then raise exception 'Assignment marker required'; end if;
end $$;
create table workdesk_private.assignment_oauth_clients (
 client_id uuid primary key,
 provider text not null unique check(provider in ('chatgpt','claude')),
 resource text not null check(resource ~ '^https://[^/?#@]+/mcp$'),
 can_write boolean not null default false,
 enabled boolean not null default false
);
alter table workdesk_private.assignment_oauth_clients enable row level security;
revoke all on workdesk_private.assignment_oauth_clients from public,anon,authenticated;
create function public.assignment_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare claims jsonb:=event->'claims'; client text:=nullif(event->'claims'->>'client_id',''); cfg workdesk_private.assignment_oauth_clients;
begin
 -- Never derive privileges from editable user_metadata or requested scopes.
 claims:=claims-'assignment_scopes'-'assignment_environment';
 if client is null then return jsonb_set(event,'{claims}',claims); end if;
 select * into cfg from workdesk_private.assignment_oauth_clients where client_id::text=client and enabled;
 if not found then
  return jsonb_set(event,'{claims}',claims || jsonb_build_object('assignment_scopes','[]'::jsonb));
 end if;
 if not exists(select 1 from workdesk_private.assignment_environment where environment='assignment' and schema_version=1) then raise exception 'Assignment marker required'; end if;
 -- Retain authenticated for Supabase APIs while binding the token to this resource.
 claims:=claims || jsonb_build_object('aud',jsonb_build_array('authenticated',cfg.resource),
  'assignment_environment','assignment','assignment_scopes',
  case when cfg.can_write then '["workboard:read","workboard:write"]'::jsonb else '["workboard:read"]'::jsonb end);
 return jsonb_set(event,'{claims}',claims);
end $$;
revoke all on function public.assignment_access_token_hook(jsonb) from public,anon,authenticated;
grant execute on function public.assignment_access_token_hook(jsonb) to supabase_auth_admin;
commit;
-- Register exact client UUIDs created by Supabase OAuth, then configure matching server env.
-- insert into workdesk_private.assignment_oauth_clients(client_id,provider,resource,can_write,enabled)
-- values ('REPLACE_CLIENT_UUID','chatgpt','https://REPLACE_HOST/mcp',true,true);
-- Repeat with a distinct Claude client UUID. Keep DCR disabled for this allowlisted MVP.
