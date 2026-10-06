create table public.root_users (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.root_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.root_users (id),
  action text not null,
  target_user_id uuid references auth.users (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.root_users enable row level security;
alter table public.root_audit_log enable row level security;

revoke all on public.root_users from anon, authenticated;
revoke all on public.root_audit_log from anon, authenticated;
grant select on public.root_users to authenticated;
grant select on public.root_audit_log to authenticated;

create policy "Root users can confirm their own access"
  on public.root_users for select to authenticated
  using (id = (select auth.uid()));

create policy "Root users can read audit history"
  on public.root_audit_log for select to authenticated
  using (actor_id = (select auth.uid()));
