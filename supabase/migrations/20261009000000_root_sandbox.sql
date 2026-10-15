alter table public.establishments
  add column is_sandbox boolean not null default false;

create unique index establishments_one_sandbox_per_owner_idx
  on public.establishments (owner_id)
  where is_sandbox;

create or replace function public.can_access_establishment(target_id uuid)
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
        (
          exists (
            select 1
            from public.root_users r
            where r.id = (select auth.uid())
          )
          and e.owner_id = (select auth.uid())
          and e.is_sandbox
          and (auth.jwt() ->> 'aal') = 'aal2'
        )
        or (
          not exists (
            select 1
            from public.root_users r
            where r.id = (select auth.uid())
          )
          and (
            e.owner_id = (select auth.uid())
            or exists (
              select 1
              from public.profiles p
              where p.id = (select auth.uid())
                and p.establishment_id = e.id
            )
          )
        )
      )
  );
$$;

drop policy "Users can read their own profile" on public.profiles;
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
          and (
            e.is_sandbox
            or not exists (
              select 1
              from public.root_users r
              where r.id = (select auth.uid())
            )
          )
      )
    )
  );

drop policy "Owners can create establishments" on public.establishments;
create policy "Owners can create establishments"
  on public.establishments for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and not exists (
      select 1
      from public.root_users r
      where r.id = (select auth.uid())
    )
  );

drop policy "Owners can update their establishments" on public.establishments;
create policy "Owners can update their establishments"
  on public.establishments for update to authenticated
  using (
    owner_id = (select auth.uid())
    and not exists (
      select 1
      from public.root_users r
      where r.id = (select auth.uid())
    )
  )
  with check (
    owner_id = (select auth.uid())
    and not exists (
      select 1
      from public.root_users r
      where r.id = (select auth.uid())
    )
  );
