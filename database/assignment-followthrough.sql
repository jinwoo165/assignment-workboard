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
