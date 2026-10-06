# Application architecture

The application uses React function components and TypeScript modules rather than class inheritance. Existing record fields, local-storage keys, role names, and UI behavior are retained so the code can evolve without discarding current data.

## Frontend responsibilities

- `src/main.tsx` mounts the React application.
- `src/App.tsx` coordinates authentication, current account and establishment, derived dashboard values, user actions, and the main screen composition. It intentionally keeps visual features in the existing view branches while domain rules are moved to separate modules.
- `src/domain/operational.ts` defines shared data contracts, initial catalog examples, compatibility readers, and pure formatting/reporting helpers.
- `src/supabase.ts` creates the browser client from public environment variables and derives the staff login email convention. The service-role secret must never be exposed to this module.
- `src/App.css` contains the POS layout and visual styles; `src/index.css` contains global styles.
- `supabase/migrations/` defines the persistent schema, row-level security, and database-side role enforcement. See [DATABASE.md](./DATABASE.md).

## Operational data lifecycle

1. Supabase Auth establishes the session. The app loads the user's profile and the establishments they are permitted to access.
2. The app reads each establishment's operational state from `public.operational_state`. Existing browser records are only considered for a first administrator import when no database row exists.
3. User actions update React state. A persistence effect sends revision-checked state through `save_operational_state`; it does not write business data to local storage.
4. The database function verifies tenant access, role permissions, state shape, and revision before saving. Rejected writes are reported to the user.
5. While a session is active, the client checks the current revision every few seconds and loads newer records from other open devices. A write conflict restores the latest database state rather than silently overwriting it.

## Change conventions

- Keep domain types and pure calculations outside the UI component.
- Keep authorization decisions in PostgreSQL RLS/functions as well as the UI; hiding a control is not an access-control boundary.
- Add schema changes as a new timestamped migration. Do not rewrite an already-applied migration.
- Preserve legacy property names or explicitly add a migration adapter when changing persisted data.
- Report persistence and authentication errors; do not pretend a failed write succeeded.
