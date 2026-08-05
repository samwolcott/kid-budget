# Supabase Migration Plan

## Goal

Move The Family Bank from browser-only localStorage persistence to Supabase so the same family data can be used across multiple devices.

The migration should feel invisible. Preserve the existing UI, workflows, and domain rules. Change the storage and authentication layers in small, reversible steps.

## Approved Decisions

- Supabase will become the shared source of truth for authenticated families.
- Supabase Auth is used for the parent account.
- Children do not create email accounts.
- A parent signs into Supabase once when setting up each household device.
- Supabase keeps that device session active.
- Parent, Judah, and Max each use a short PIN for everyday access.
- A kid device may be remembered as Judah or Max and open directly to that child's PIN screen.
- A successful PIN unlock lasts for the current browser session.
- The parent dashboard requires the parent PIN.
- The initial version fetches on page load and saves after every mutation.
- Realtime subscriptions are deferred.
- LocalStorage remains available as a cache, migration backup, and signed-out demo store.
- The database uses normalized family, kid, balance, goal, transaction, and purchase-request records.
- Monetary values are stored as integer cents.

## Security Boundary

The initial PIN system is a trusted-household application lock. It prevents casual access through the normal UI, but it is not a separate Supabase identity for each child.

The browser still holds the parent's Supabase session after device setup. Database Row Level Security must isolate one family from every other family, but the initial version does not claim to protect parent data from a technically sophisticated child using browser developer tools.

Database-enforced child identities can be added later without changing the visible PIN experience.

Never expose a Supabase service-role key. The static GitHub Pages app may use only the public project URL and publishable key. Enable Row Level Security on every exposed table.

## Data Model

### families

- id
- name
- created_at
- updated_at

### family_members

- family_id
- user_id
- role

### family_settings

- family_id
- parent_pin_verifier
- allowance_spending_percent
- allowance_saving_percent
- allowance_giving_percent
- revision
- updated_at

### kids

- id
- family_id
- slug
- name
- emoji
- allowance_amount_cents
- pin_verifier
- created_at
- updated_at

### bucket_balances

- kid_id
- spending_cents
- saving_cents
- giving_cents
- updated_at

### goals

- id
- kid_id
- name
- emoji
- target_cents
- saved_cents
- created_at
- updated_at

### transactions

- id
- kid_id
- type
- bucket
- amount_cents
- description
- created_at

### purchase_requests

- id
- kid_id
- description
- amount_cents
- bucket
- status
- requested_at
- resolved_at

Use foreign keys, status/type constraints, and nonnegative balance constraints. Multi-record financial mutations must run atomically through database functions.

## Architecture

Do not rewrite the application.

```text
Current: UI → store.ts → localStorage
Future:  UI → store.ts → storage repository → Supabase
                                      └──────→ local cache
```

Keep the existing `FamilyBankState` as the UI-facing model. The Supabase repository maps normalized database rows to and from that model.

Move any remaining direct page mutations into the storage/domain boundary before cloud writes are enabled.

## Sync and Offline Rules

- Fetch the complete family state on page load.
- Save after every successful mutation.
- Apply optimistic UI updates.
- Cache the last confirmed cloud state locally.
- If a read fails, show cached data and log the offline state for troubleshooting.
- If a write fails, clearly mark it unsynced and notify the parent.
- Never silently discard or overwrite an unsynced financial mutation.
- Use revisions or another optimistic-concurrency mechanism to detect stale writes.
- Defer Realtime and general websocket synchronization.

## Production and Retry

Authenticated families use Supabase automatically. An unconfigured or signed-out browser uses the separate LocalStorage demo. GitHub Pages receives `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` from repository Actions variables during its build.

Every write is atomic and revision-checked. While a write is pending, mutation buttons are disabled. After success, the application reads the server state back and caches that confirmed revision. If a write fails or another device has a newer revision, use **Reload & Retry** before submitting the intended change again. Failed changes are not queued or silently replayed.

If an authenticated family cannot be loaded and no confirmed cache exists, the repository becomes unavailable and rejects changes. It must never fall back to writable local demo data. Parent password recovery returns through `/reset-password/`, which must be included in the project's allowed Auth redirect URLs.

The last confirmed family snapshot is cached under `family-bank-cloud-cache-v1` and is scoped to the authenticated family. Storage and synchronization details are logged to the browser console. Do not edit the cache manually.

Deploy database changes only from `supabase/migrations/` using the connected GitHub integration or `npx supabase db push`. Never rewrite migration history or reproduce migrations manually in the SQL editor. Before a schema release, run the pgTAP family-isolation test and database lint with Docker available. The rollback for a schema change must be a new forward migration; do not delete an applied migration.

## Foundation Setup

The browser client reads these optional public variables:

```text
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Copy `.env.example` to `.env` for local development. Never add a database password or service-role key to a browser environment variable.

The version-controlled Supabase project is in `supabase/`:

- `migrations/` contains the schema, RLS policies, grants, and atomic functions.
- `tests/database/` contains the family-isolation pgTAP test.
- `config.toml` keeps unused Realtime, Storage, and seed services disabled.

With Docker running, validate locally before deployment:

```sh
npx supabase start
npx supabase test db
npx supabase db lint
```

The connected GitHub integration can deploy migrations from `main`. Alternatively, authenticate the CLI, link the project, and run `npx supabase db push`. Do not reproduce migrations manually in the dashboard because that bypasses migration history.

## Migration Sprints

Implement exactly one unchecked sprint at a time. Every sprint must leave the application working and include proportionate verification.

### Sprint S1 — Async Storage Boundary

- [x] Introduce a small asynchronous storage repository contract.
- [x] Implement the contract with LocalStorage only.
- [x] Keep existing LocalStorage keys and data compatible.
- [x] Move direct page-level financial mutations behind the domain/storage boundary.
- [x] Add clear load and save error handling.
- [x] Preserve all existing behavior and UI.

Acceptance criteria:

- The application remains LocalStorage-only.
- Existing browser data still loads.
- Every existing feature works after refresh.
- No Supabase dependency or configuration is required.

### Sprint S2 — Supabase Foundation

- [x] Add the Supabase browser client and documented public environment variables.
- [x] Add version-controlled SQL migrations for the approved schema.
- [x] Enable Row Level Security on every exposed table.
- [x] Add parent ownership policies based on `auth.uid()`.
- [x] Add atomic database functions needed by multi-record mutations.
- [x] Keep LocalStorage as the active application repository.

Acceptance criteria:

- The app works normally without Supabase configuration.
- The production bundle contains no privileged key.
- Two unrelated test users cannot read or change each other's family data.

### Sprint S3 — Parent Authentication

- [x] Add parent sign-in, session restoration, and sign-out.
- [x] Create or load the authenticated parent's family.
- [x] Add loading and authentication-error states matching the current design.
- [x] Keep budgeting data in LocalStorage.
- [x] Preserve a signed-out local demo mode.

Acceptance criteria:

- A parent signs in once and remains signed in after refresh.
- Signing out does not delete local budgeting data.
- No child email account is required.

### Sprint S4 — Profile PIN Lock

- [x] Add PIN setup for Parent, Judah, and Max.
- [x] Turn the home page into the profile chooser and lock screen.
- [x] Guard parent and kid routes against locked profiles.
- [x] Store only the temporary unlock in `sessionStorage`.
- [x] Allow a device to be remembered as Judah or Max.
- [x] Add visible Lock and Switch Profile controls.
- [x] Add basic failed-attempt throttling in the UI.

Acceptance criteria:

- Kid devices do not require repeated email/password sign-in.
- Remembered devices open directly to the assigned child's PIN screen.
- A child cannot reach another dashboard through normal navigation without its PIN.
- The parent dashboard requires the parent PIN.

### Sprint S5 — Explicit Local Data Import (Removed)

This transitional sprint was removed by product decision. Existing LocalStorage budget data will not be uploaded. The cloud budget can begin fresh when the Supabase repository is enabled, while signed-out demo mode retains its separate local data.

### Sprint S6 — Supabase Read Path

- [x] Add a Supabase implementation of the storage repository.
- [x] Fetch and map the complete normalized family state.
- [x] Make cloud reads opt-in for the authenticated family.
- [x] Cache successful reads locally.
- [x] Add loading, cached, offline, and empty-cloud states.
- [x] Keep cloud writes disabled.

Acceptance criteria:

- Cloud data renders without changing dashboard components.
- A failed cloud read shows the last cache without corrupting it.
- Local mode remains available as a rollback.

### Sprint S7 — Supabase Mutation Path

- [x] Persist allowance payments atomically.
- [x] Persist manual balance adjustments atomically.
- [x] Persist bucket transfers atomically.
- [x] Persist purchase request creation and resolution atomically.
- [x] Persist every goal mutation atomically.
- [x] Disable duplicate submissions while a save is pending.
- [x] Confirm and cache server state after success.
- [x] Roll back or mark state unsynced after failure.

Acceptance criteria:

- Every current feature survives refresh on a second device.
- Partial financial updates are impossible.
- Stale revisions produce a visible conflict instead of silently overwriting data.

### Sprint S8 — Offline Writes and Recovery (Deferred)

The full ordered offline mutation queue and conflict-resolution UI are deferred. The first cloud version will cache successful reads, reject failed writes visibly, and ask the family to retry after reconnecting. This keeps failure behavior honest without adding queue complexity to the initial family app.

### Sprint S9 — Simplified Cutover and Hardening

- [x] Make Supabase the default repository for authenticated families.
- [x] Retain LocalStorage only for the confirmed-cloud cache and signed-out demo mode.
- [x] Remove the temporary read-only preview toggle.
- [x] Test every mutation under network failure.
- [x] Keep unrelated-family Row Level Security coverage in the versioned pgTAP test.
- [x] Verify the built assets contain no privileged credentials.
- [x] Document setup, migrations, rollback, retry, and recovery here.

Acceptance criteria:

- The same family state works reliably across devices.
- Signed-out demo mode still works.
- The migration has a documented rollback path.
- Realtime, notifications, multiple parents, and separate child identities remain out of scope.

## Future Work

- Full offline write queue and conflict recovery
- Realtime subscriptions
- Notifications
- Multiple parents
- Grandparent access
- Database-enforced child device identities
- Expanded audit and reporting tools
