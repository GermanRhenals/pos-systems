# Database structure and access model

Kuantika POS uses Supabase PostgreSQL for identity, establishment ownership, staff profiles, and operational records. Apply SQL migrations in timestamp order; migrations are append-only so an installed database can be upgraded without replacing existing data.

## Migration order

1. `20261006000000_initial_schema.sql` creates administrator/staff profiles and establishments, the auth-user profile trigger, and establishment-scoped access checks.
2. `20261007000000_root_operator.sql` adds privileged support accounts and an audit log for root operations.
3. `20261008000000_operational_state.sql` adds persistent inventory, sales, requests, and shift state.
4. `20261009000000_root_sandbox.sql` marks the root-owned test establishment and limits root operational access to that sandbox.
5. `20261016000000_bar_direct_sales.sql` replaces `save_operational_state` so bar staff can record validated direct walk-in sales (no waiter request) while keeping catalog, shift and append-only rules intact.
6. `20261017000000_operational_incidents.sql` replaces `save_operational_state` again to add the admin-only `incidents` list (accidental losses and stock shortages); waiter and bar callers must leave it unchanged.

## Tables and ownership

### `public.profiles`

One row per authenticated user. The row ID references `auth.users`; `role` is constrained to `admin`, `waiter`, or `bar`. Staff profiles have a unique username, a work zone, and an assigned establishment. Admin profiles are establishment owners rather than staff members, so their `establishment_id` is normally null.

### `public.establishments`

One row per business location. `owner_id` references the administrator's Auth user. The name, city, country, tax identifier, and creation timestamp describe the business. Staff access is granted by the `profiles.establishment_id` assignment.

### `public.root_users` and `public.root_audit_log`

These tables are created by the root-operator migration. Root identities are provisioned by an owner through SQL, not public registration. Root actions require elevated authentication and are written to the audit log.

### Root test establishment

### Root test establishment

The root-sandbox migration adds `establishments.is_sandbox` and confines root operational access in RLS (`can_access_establishment`) and `save_operational_state` to a single sandbox establishment per root account, so a root session can never read or write a customer's operational state.

The in-app test experience itself is deliberately client-only: from the root console, "Entrar a probar" builds a local `Testing establecimiento` with synthetic inventory and no database association. Nothing is persisted, no revision is saved, and leaving the sandbox discards the temporary records. Normal root account administration remains behind the audited Edge Function.

### `public.operational_state`

One row per establishment, keyed by `establishment_id`. Its `state` JSON document contains:

- `products`: inventory items and stock levels;
- `sales`: recorded sale line items and ticket metadata;
- `requests`: waiter orders and dispatch status;
- `incidents`: admin-recorded losses (broken bottles, missing units, defective crates) with the economic value of each event;
- `turn`: the current shift start/end timestamps.

`incidents` is optional for backwards compatibility: rows written before the incidents migration are read with an empty list.

`revision` is incremented on each successful save. The browser sends the revision it last read, so stale writes are rejected instead of silently replacing a newer version from another device. Staff records are intentionally excluded from this document and remain sourced from `profiles`.

## Access-control functions and policies

`can_access_establishment(uuid)` is a stable, security-definer helper that returns true for an establishment owner or a staff profile assigned to that establishment. Row-level security uses it to scope establishment and operational-state reads.

`save_operational_state(uuid, jsonb, bigint)` is the only write path for operational state. Direct table writes are revoked from browser roles. The function verifies establishment access and the expected revision, then enforces role-specific behavior:

- **Admin:** may manage products, sales, requests, incidents, and shift state.
- **Waiter:** may append only their own pending requests; cannot alter inventory, sales, incidents, or shifts.
- **Bar:** may dispatch existing requests, decrease stock by exactly the requested quantities, record matching sale items, and record direct walk-in sales at the bar (`channel: 'barra'`). Direct sales are only accepted while the shift is open, must be attributed to the caller's staff profile, must equal the current catalog price times the quantity, and each unit sold must be deducted from inventory; bar users cannot edit product details, incidents, increase stock or change shifts.
- **Root:** has no operational-state access through this RPC.

All browser requests use the authenticated Supabase client. Never expose the service-role key in frontend configuration.

## Existing browser data

On an administrator's first sign-in after the operational-state migration is installed, the app imports the legacy records and turn state already stored under the same establishment ID, but only if no database record exists for that establishment. Once the database row is present, it is authoritative; browser storage is not used as a fallback for operational writes.

The client polls the current revision while the app is open to pick up updates from another device. Revision conflicts are reported and the latest database copy is restored rather than silently overwriting another user's changes. This is refresh-based synchronization, not offline write support.
