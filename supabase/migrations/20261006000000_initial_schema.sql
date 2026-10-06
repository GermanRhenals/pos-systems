create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  full_name text not null,
  role text not null check (role in ('admin', 'waiter', 'bar')),
  zone text not null default '',
  establishment_id uuid,
  created_at timestamptz not null default now(),
  constraint profiles_staff_has_username check (role = 'admin' or username is not null)
);

create table public.establishments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  city text not null,
  country text not null,
  tax_id text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_establishment_id_fkey
  foreign key (establishment_id) references public.establishments (id) on delete cascade;

create index establishments_owner_id_idx on public.establishments (owner_id);
create index profiles_establishment_id_idx on public.profiles (establishment_id);

create function public.can_access_establishment(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.establishments e
    where e.id = target_id
      and (
        e.owner_id = (select auth.uid())
        or exists (
          select 1
          from public.profiles p
          where p.id = (select auth.uid())
            and p.establishment_id = e.id
        )
      )
  );
$$;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_role text := coalesce(new.raw_app_meta_data ->> 'role', 'admin');
  new_establishment_id uuid;
begin
  if new_role not in ('admin', 'waiter', 'bar') then
    raise exception 'Invalid user role';
  end if;

  if new_role = 'admin' then
    insert into public.profiles (id, full_name, role)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', 'Administrador'), 'admin');
  else
    new_establishment_id := (new.raw_app_meta_data ->> 'establishment_id')::uuid;
    insert into public.profiles (id, username, full_name, role, zone, establishment_id)
    values (
      new.id,
      lower(new.raw_app_meta_data ->> 'username'),
      coalesce(new.raw_app_meta_data ->> 'full_name', ''),
      new_role,
      coalesce(new.raw_app_meta_data ->> 'zone', ''),
      new_establishment_id
    );
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.establishments enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.establishments from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update on public.establishments to authenticated;
revoke all on function public.can_access_establishment(uuid) from public, anon;
grant execute on function public.can_access_establishment(uuid) to authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (
      role in ('waiter', 'bar')
      and exists (
        select 1
        from public.establishments e
        where e.id = profiles.establishment_id
          and e.owner_id = (select auth.uid())
      )
    )
  );

create policy "Owners can create establishments"
  on public.establishments for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "Owners and assigned staff can read establishments"
  on public.establishments for select to authenticated
  using (public.can_access_establishment(id));

create policy "Owners can update their establishments"
  on public.establishments for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
