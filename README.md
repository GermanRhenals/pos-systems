# Kuantika POS

Sistema de punto de venta y operaciones para establecimientos, construido con React, TypeScript y Vite.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## GitHub Pages

The production site is published at [https://germanrhenals.github.io/pos-systems/](https://germanrhenals.github.io/pos-systems/). The `Deploy to GitHub Pages` workflow builds and deploys the app whenever changes are pushed to `master`.

In the repository settings, open **Pages** and set the build and deployment source to **GitHub Actions**. The development server continues to use the root path locally.

## Supabase setup

The local Supabase URL and publishable key belong in `.env.local`; use `.env.example` as a template. The publishable key is intended for browser use. Never put a Supabase secret or service-role key in a `VITE_` variable.

1. In the Supabase SQL Editor, run both files in `supabase/migrations/` in timestamp order: first `20261006000000_initial_schema.sql`, then `20261007000000_root_operator.sql`.
2. Install or run the Supabase CLI, link this project with ref `ccsdpdeyfnqcukguyvyd`, then deploy the `manage-staff` Edge Function:

   ```sh
   npx supabase login
   npx supabase link --project-ref ccsdpdeyfnqcukguyvyd
   npx supabase functions deploy manage-staff
   npx supabase functions deploy root-console
   ```

   The Dashboard's **Edge Functions → Deploy a new function → Via Editor** flow is an alternative, using the corresponding `index.ts` source under `supabase/functions/`. Keep legacy JWT verification disabled for `root-console`: it validates the bearer token, requires AAL2, and checks `root_users` itself. This setting is mirrored in `supabase/config.toml`.

   The functions use the project's server-side `SUPABASE_SERVICE_ROLE_KEY`; if it is not already available to Edge Functions, set it as a Supabase Function secret. Never place it in `.env.local`, GitHub Pages variables, or frontend code.
3. In Supabase **Authentication → URL Configuration**, add the local and GitHub Pages URLs to the allowed redirect URLs. Email/password provider must be enabled; email confirmation can remain on.
4. In GitHub repository **Settings → Secrets and variables → Actions**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` so GitHub Pages builds can connect to Supabase.
5. Admins register with email and password. Mesero and Bar accounts use username and password; staff accounts are created by the authenticated Edge Function and are assigned to one establishment.
6. To provision the first root operator, create and confirm a dedicated administrator account, then add its Auth user ID manually from the SQL Editor:

   ```sql
   insert into public.root_users (id)
   select id from auth.users where email = 'root@example.com'
   on conflict (id) do nothing;
   ```

   Root access is not available through public registration. The root console requires TOTP multi-factor authentication, lists administrator account and establishment details, supports only profile/establishment corrections and account suspension/reactivation, and records those actions in `root_audit_log`. Never promote a normal admin from the public app; provisioning is an owner-only database operation.

Authentication and establishment details are stored in Supabase. Inventory, sales, requests, and shift data still use browser storage and will need a separate database migration before they are shared between devices.
