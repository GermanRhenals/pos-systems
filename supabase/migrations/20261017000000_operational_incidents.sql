-- Register accidental losses (broken bottles, missing units in a beer crate,
-- defective liquor crates, etc.) in the operational snapshot. Incidents are
-- admin-only: waiters and bar staff must keep the incidents list byte-for-byte
-- identical, so their branches add an explicit guard below.
--
-- This is the 20261016000000 function plus the incidents guard; all direct-sale
-- and dispatch validation below is unchanged.
--
-- Allow bar staff to record validated walk-in sales at the bar (no waiter
-- request behind them). Direct sales are marked with channel = 'barra' and
-- must be fully justified against the catalog and inventory: the recorded
-- total has to equal price x quantity, the seller is attributed from
-- profiles.full_name, and every stock decrease must equal the dispatched
-- request quantities plus the appended direct-sale quantities. Append-only
-- sales and untouched shift/product details remain mandatory for bar users.
create or replace function public.save_operational_state(
  target_establishment_id uuid,
  new_state jsonb,
  expected_revision bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision bigint;
  current_state jsonb;
  caller_role text;
  caller_name text;
  new_request jsonb;
  old_request jsonb;
  old_product jsonb;
  new_product jsonb;
  product_delta numeric;
  expected_delta numeric;
  direct_delta numeric;
  request_item jsonb;
  new_sale jsonb;
  product_name text;
  saved_revision bigint;
begin
  -- Verify tenant membership before reading or changing the operational snapshot.
  if not public.can_access_establishment(target_establishment_id) then
    raise exception 'not authorized for establishment';
  end if;

  -- Reject malformed payloads before any JSON fields are used as arrays or objects.
  if expected_revision is null
    or not (new_state ?& array['products', 'sales', 'requests', 'turn'])
    or jsonb_typeof(new_state) is distinct from 'object'
    or jsonb_typeof(new_state->'products') is distinct from 'array'
    or jsonb_typeof(new_state->'sales') is distinct from 'array'
    or jsonb_typeof(new_state->'requests') is distinct from 'array'
    or jsonb_typeof(new_state->'turn') is distinct from 'object' then
    raise exception 'invalid operational state';
  end if;

  -- Derive the caller's role from trusted database records, never from client input.
  select p.role, p.full_name
  into caller_role, caller_name
  from public.profiles p
  where p.id = (select auth.uid())
    and p.establishment_id = target_establishment_id;

  if caller_role is null then
    select 'admin' into caller_role
    from public.establishments e
    where e.id = target_establishment_id
      and e.owner_id = (select auth.uid());
  end if;

  if caller_role is null then
    raise exception 'not authorized for operational state';
  end if;

  -- Lock the tenant row and compare revisions to prevent lost updates across devices.
  select os.revision, os.state
  into current_revision, current_state
  from public.operational_state os
  where os.establishment_id = target_establishment_id
  for update;

  if not found then
    if expected_revision <> 0 or caller_role <> 'admin' then
      raise exception 'operational state changed; reload and retry';
    end if;

    insert into public.operational_state (establishment_id, state)
    values (target_establishment_id, new_state)
    on conflict (establishment_id) do nothing
    returning revision into saved_revision;
    if saved_revision is null then
      raise exception 'operational state changed; reload and retry';
    end if;
    return saved_revision;
  end if;

  if current_revision <> expected_revision then
    raise exception 'operational state changed; reload and retry';
  end if;

  -- A waiter can append only their own pending requests.
  if caller_role = 'waiter' then
    if new_state->'products' <> current_state->'products'
      or new_state->'sales' <> current_state->'sales'
      or new_state->'turn' <> current_state->'turn'
      or new_state->'incidents' is distinct from current_state->'incidents'
      or not (new_state->'requests' @> current_state->'requests') then
      raise exception 'waiters may only add their own requests';
    end if;

    for new_request in
      select item
      from jsonb_array_elements(new_state->'requests') as requests(item)
    loop
      if not (current_state->'requests' @> jsonb_build_array(new_request))
        and (
          new_request->>'requesterId' is distinct from (select auth.uid())::text
          or new_request->>'status' is distinct from 'Pendiente'
        ) then
        raise exception 'waiters may only add their own pending requests';
      end if;
    end loop;
  -- Bar staff may dispatch requests and record direct walk-in sales, but cannot
  -- edit the catalog or shift lifecycle.
  elsif caller_role = 'bar' then
    if new_state->'incidents' is distinct from current_state->'incidents' then
      raise exception 'bar users may not edit incident records';
    end if;

    if new_state->'turn' <> current_state->'turn' then
      raise exception 'bar users may not change shift state';
    end if;
    if not (new_state->'sales' @> current_state->'sales') then
      raise exception 'bar users may not edit or remove recorded sales';
    end if;

    -- Append-only with multiplicity: every sale beyond the current count must
    -- be a genuinely new element, so recorded revenue cannot be inflated by
    -- duplicating an existing sale without touching inventory.
    if (
      select count(*)
      from jsonb_array_elements(new_state->'sales') as sales(item)
      where not (current_state->'sales' @> jsonb_build_array(sales.item))
    ) <> jsonb_array_length(new_state->'sales') - jsonb_array_length(current_state->'sales') then
      raise exception 'bar users may not edit or duplicate recorded sales';
    end if;

    -- Direct sales only while the shift is open, matching the application rules.
    if jsonb_array_length(new_state->'sales') > jsonb_array_length(current_state->'sales')
      and current_state->'turn'->>'endedAt' is not null then
      raise exception 'bar users may not record sales while the shift is closed';
    end if;

    if jsonb_array_length(new_state->'requests') <> 0
      and jsonb_array_length(new_state->'requests') <> jsonb_array_length(current_state->'requests') then
      raise exception 'bar users may only dispatch or clear existing requests';
    end if;

      if jsonb_array_length(new_state->'requests') = 0 then
        for old_request in
          select item
          from jsonb_array_elements(current_state->'requests') as requests(item)
        loop
          if old_request->>'status' <> 'Despachado' then
            raise exception 'bar users may not clear pending requests';
          end if;
        end loop;
      end if;

    for new_request in
      select item
      from jsonb_array_elements(new_state->'requests') as requests(item)
    loop
      select item into old_request
      from jsonb_array_elements(current_state->'requests') as requests(item)
      where item->>'id' = new_request->>'id';

      if old_request is null
        or (new_request - 'status') is distinct from (old_request - 'status')
        or not (
          new_request->>'status' is not distinct from old_request->>'status'
          or (
            old_request->>'status' is not distinct from 'Pendiente'
            and new_request->>'status' is not distinct from 'Despachado'
          )
        ) then
        raise exception 'bar users may only update a request status to dispatched';
      end if;
    end loop;

    for old_product in
      select item
      from jsonb_array_elements(current_state->'products') as products(item)
    loop
      select item into new_product
      from jsonb_array_elements(new_state->'products') as products(item)
      where item->>'id' = old_product->>'id';

      if new_product is null
        or (new_product - 'stock') is distinct from (old_product - 'stock')
        or new_product->>'stock' is null
        or old_product->>'stock' is null
        or (new_product->>'stock')::numeric > (old_product->>'stock')::numeric
        or (new_product->>'stock')::numeric < 0 then
        raise exception 'bar users may not edit product details, increase stock, or leave negative stock';
      end if;

      select coalesce(sum((line->>'quantity')::numeric), 0)
      into expected_delta
      from jsonb_array_elements(current_state->'requests') as old_requests(request)
      join jsonb_array_elements(new_state->'requests') as new_requests(request)
        on new_requests.request->>'id' = old_requests.request->>'id'
      cross join lateral jsonb_array_elements(old_requests.request->'itemsList') as items(line)
      where old_requests.request->>'status' = 'Pendiente'
        and new_requests.request->>'status' = 'Despachado'
        and line->>'productId' = old_product->>'id';

      -- Stock may also drop by exactly the quantities of the new direct sales.
      select coalesce(sum((sale->>'quantity')::numeric), 0)
      into direct_delta
      from jsonb_array_elements(new_state->'sales') as added_sales(sale)
      where sale->>'channel' = 'barra'
        and sale->>'productId' = old_product->>'id'
        and not (current_state->'sales' @> jsonb_build_array(sale));

      product_delta := (old_product->>'stock')::numeric - (new_product->>'stock')::numeric;
      if product_delta <> expected_delta + direct_delta then
        raise exception 'product stock change must match dispatched requests or direct bar sales';
      end if;
    end loop;

    for old_request in
      select item
      from jsonb_array_elements(current_state->'requests') as requests(item)
    loop
      select item into new_request
      from jsonb_array_elements(new_state->'requests') as requests(item)
      where item->>'id' = old_request->>'id';

      if old_request->>'status' = 'Pendiente' and new_request->>'status' = 'Despachado' then
        if jsonb_typeof(old_request->'itemsList') is distinct from 'array' then
          raise exception 'cannot dispatch a request without item details';
        end if;
        for request_item in
          select item
          from jsonb_array_elements(old_request->'itemsList') as items(item)
        loop
          select item->>'name' into product_name
          from jsonb_array_elements(current_state->'products') as products(item)
          where item->>'id' = request_item->>'productId';

          if product_name is null
            or (
              select count(*)
              from jsonb_array_elements(new_state->'sales') as sales(item)
              where item->>'requestId' = old_request->>'id'
                and item->>'product' = product_name
                and item->>'quantity' = request_item->>'quantity'
                and (item->>'total')::numeric =
                  coalesce((request_item->>'unitPrice')::numeric, (
                    select (product->>'price')::numeric
                    from jsonb_array_elements(current_state->'products') as products(product)
                    where product->>'id' = request_item->>'productId'
                  )) * (request_item->>'quantity')::numeric
            ) <> 1 then
            raise exception 'recorded sale does not match the dispatched request';
          end if;
        end loop;

        if (
          select count(*)
          from jsonb_array_elements(new_state->'sales') as sales(item)
          where item->>'requestId' = old_request->>'id'
        ) <> jsonb_array_length(old_request->'itemsList') then
          raise exception 'dispatch must record exactly one sale per request item';
        end if;
      end if;
    end loop;

    for new_sale in
      select item
      from jsonb_array_elements(new_state->'sales') as sales(item)
    loop
      if not (current_state->'sales' @> jsonb_build_array(new_sale))
        and not exists (
          select 1
          from jsonb_array_elements(current_state->'requests') as old_requests(request)
          join jsonb_array_elements(new_state->'requests') as new_requests(request)
            on new_requests.request->>'id' = old_requests.request->>'id'
          cross join lateral jsonb_array_elements(old_requests.request->'itemsList') as items(line)
          where old_requests.request->>'status' = 'Pendiente'
            and new_requests.request->>'status' = 'Despachado'
            and new_sale->>'requestId' = old_requests.request->>'id'
            and new_sale->>'quantity' = items.line->>'quantity'
            and new_sale->>'product' = (
              select product->>'name'
              from jsonb_array_elements(current_state->'products') as products(product)
              where product->>'id' = items.line->>'productId'
            )
            and (new_sale->>'total')::numeric = coalesce(
              (items.line->>'unitPrice')::numeric,
              (
                select (product->>'price')::numeric
                from jsonb_array_elements(current_state->'products') as products(product)
                where product->>'id' = items.line->>'productId'
              )
            ) * (items.line->>'quantity')::numeric
        )
        -- Direct walk-in sale: marked 'barra', unlinked from requests, attributed
        -- to the caller, and priced exactly like the current catalog.
        and not coalesce(
          new_sale->>'channel' = 'barra'
          and new_sale->>'requestId' is null
          and new_sale->>'server' = caller_name
          and jsonb_typeof(new_sale->'quantity') = 'number'
          and jsonb_typeof(new_sale->'total') = 'number'
          and jsonb_typeof(new_sale->'createdAt') = 'number'
          and (new_sale->>'quantity')::numeric >= 1
          and (new_sale->>'quantity')::numeric = trunc((new_sale->>'quantity')::numeric)
          and exists (
            select 1
            from jsonb_array_elements(current_state->'products') as catalog(item)
            where item->>'id' = new_sale->>'productId'
              and item->>'name' = new_sale->>'product'
              and jsonb_typeof(item->'price') = 'number'
              and (new_sale->>'total')::numeric =
                (item->>'price')::numeric * (new_sale->>'quantity')::numeric
          ),
          false
        ) then
        raise exception 'bar users may only record sales from a dispatched request or as a direct bar sale';
      end if;
    end loop;
  elsif caller_role <> 'admin' then
    raise exception 'role may not change operational state';
  end if;

  -- Only a validated state reaches the write and revision increment.
  update public.operational_state
  set state = new_state,
      revision = revision + 1,
      updated_at = now()
  where establishment_id = target_establishment_id
  returning revision into saved_revision;

  return saved_revision;
end;
$$;

revoke all on function public.save_operational_state(uuid, jsonb, bigint) from public, anon;
grant execute on function public.save_operational_state(uuid, jsonb, bigint) to authenticated;
