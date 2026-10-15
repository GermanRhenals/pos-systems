# AGENTS.md

Kuantika POS: React 19 + TypeScript + Vite SPA backed by Supabase. UI strings are Spanish (`es-CO`); code comments are English.

## Commands

- `npm run dev` — Vite dev server (`base` is `/` locally).
- `npm run build` — `tsc -b && vite build`. Type-checking is part of the build.
- `npm run lint` — `oxlint` only.
- `npm run preview` — preview the production build.
- **No test runner configured.** Do not run `npm test`/`vitest`/`jest`. Verify with `npm run lint && npm run build`.

## TypeScript build gotchas

- `noUnusedLocals` / `noUnusedParameters` — remove unused vars/params/imports.
- `verbatimModuleSyntax` — use `import type { ... }` for type-only imports.
- `erasableSyntaxOnly` — no `enum`, `namespace`, or parameter properties.
- `allowImportingTsExtensions` — relative imports must include `.tsx`/`.ts` extension (e.g., `import App from './App.tsx'`).

## Architecture

- `src/App.tsx` (~950 lines) owns screens, auth, and Supabase wiring. `src/domain/operational.ts` holds shared types + pure helpers. `src/supabase.ts` creates the browser client and staff-email convention. `src/components/PrivacyNotice.tsx` is the shared notice.
- Keep domain types/pure calculations out of UI. Add schema changes as a new migration; do not edit `App.tsx` state shape ad hoc.
- `public.operational_state` is the authoritative source for products/sales/requests/turn. **Do not** treat `localStorage` as the source of business records — only for legacy first-admin import, establishment prefs, and turn bootstrap.
- Only write path: RPC `save_operational_state(establishment_id, state, expected_revision)`. Revision-checked; on conflict client reloads DB copy. Clients poll every ~4s for cross-device sync (no offline writes).
- Roles: `admin`, `waiter`, `bar`, plus `root` (owner-provisioned only, never public; requires TOTP MFA, audited; limited to its sandbox establishment).
- Dev only: `?root-preview=1` renders local root-console preview (`import.meta.env.DEV`) with no real data.

## Supabase workflow

- Migrations are **append-only**, applied in timestamp order manually in SQL editor. Never rewrite already-applied migrations; add a new timestamped file.
- Edge Functions: `supabase/functions/manage-staff` (`verify_jwt = true`), `supabase/functions/root-console` (`verify_jwt = false`; validates bearer token, requires AAL2, checks `root_users` itself). Deploy: `npx supabase functions deploy <name>` (project ref `ccsdpdeyfnqcukguyvyd`).
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` may reach browser. **Never** put `SUPABASE_SERVICE_ROLE_KEY` (or any secret) in frontend code or `VITE_` vars.
- Staff sign in with synthetic emails `<username>@staff.<project-host>` (see `staffAuthEmail` in `src/supabase.ts`); accounts created only via `manage-staff`.
- Authorization lives in Postgres RLS/RPC (hiding UI is not a boundary). Surface persistence/auth errors; never silently swallow failed writes.

## Deploy & config

- GitHub Pages triggered on push to **`master`** via `.github/workflows/deploy.yml`; requires Actions secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- `vite.config.ts` sets `base` to `/pos-systems/` when `GITHUB_ACTIONS === 'true'`; local dev stays `/`.
- Repo: `GermanRhenals/pos-systems` (package `kuantika-pos`); site: https://germanrhenals.github.io/pos-systems/.

## References

- `README.md` — setup, Supabase provisioning, first root operator, copyright policy.
- `docs/ARCHITECTURE.md` — frontend responsibilities and operational-data lifecycle (RPC state shape).
- `docs/DATABASE.md` — schema, migration order, ownership, role permissions.
