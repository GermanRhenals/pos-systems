# Database structure and access model

Kuantika POS uses Supabase PostgreSQL for identity, establishment ownership, staff profiles, and operational records. Apply SQL migrations in timestamp order; migrations are append-only so an installed database can be upgraded without replacing existing data.

## Migration order

1. `20261006000000_initial_schema.sql` creates administrator/staff profiles and establishments, the auth-user profile trigger, and establishment-scoped access checks.
2. `20261007000000_root_operator.sql` adds privileged support accounts and an audit log for root operations.
3. `20261008000000_operational_state.sql` adds persistent inventory, sales, requests, and shift state.

## Tables and ownership

### `public.profiles`

One row per authenticated user. The row ID references `auth.users`; `role` is constrained to `admin`, `waiter`, or `bar`. Staff profiles have a unique username, a work zone, and an assigned establishment. Admin profiles are establishment owners rather than staff members, so their `establishment_id` is normally null.

### `public.establishments`

One row per business location. `owner_id` references the administrator's Auth user. The name, city, country, tax identifier, and creation timestamp describe the business. Staff access is granted by the `profiles.establishment_id` assignment.

### `public.root_users` and `public.root_audit_log`

These tables are created by the root-operator migration. Root identities are provisioned by an owner through SQL, not public registration. Root actions require elevated authentication and are written to the audit log.

### `public.operational_state`

One row per establishment, keyed by `establishment_id`. Its `state` JSON document contains:

- `products`: inventory items and stock levels;
- `sales`: recorded sale line items and ticket metadata;
- `requests`: waiter orders and dispatch status;
- `turn`: the current shift start/end timestamps.

`revision` is incremented on each successful save. The browser sends the revision it last read, so stale writes are rejected instead of silently replacing a newer version from another device. Staff records are intentionally excluded from this document and remain sourced from `profiles`.

## Access-control functions and policies

`can_access_establishment(uuid)` is a stable, security-definer helper that returns true for an establishment owner or a staff profile assigned to that establishment. Row-level security uses it to scope establishment and operational-state reads.

`save_operational_state(uuid, jsonb, bigint)` is the only write path for operational state. Direct table writes are revoked from browser roles. The function verifies establishment access and the expected revision, then enforces role-specific behavior:

- **Admin:** may manage products, sales, requests, and shift state.
- **Waiter:** may append only their own pending requests; cannot alter inventory, sales, or shifts.
- **Bar:** may dispatch existing requests, decrease stock by exactly the requested quantities, and record matching sale items; cannot edit product details or shifts.
- **Root:** has no operational-state access through this RPC.

All browser requests use the authenticated Supabase client. Never expose the service-role key in frontend configuration.

## Existing browser data

On an administrator's first sign-in after the operational-state migration is installed, the app imports the legacy records and turn state already stored under the same establishment ID, but only if no database record exists for that establishment. Once the database row is present, it is authoritative; browser storage is not used as a fallback for operational writes.

The client polls the current revision while the app is open to pick up updates from another device. Revision conflicts are reported and the latest database copy is restored rather than silently overwriting another user's changes. This is refresh-based synchronization, not offline write support.
