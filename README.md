# Kelly's Deli — Food Log

A digital replacement for the paper SFBB (Safer Food, Better Business) diary, built for a
shared kitchen iPad. Everything an EHO asks for, recorded in a few taps:

| Module | What it records |
| --- | --- |
| 🧊 Fridge / freezer checks | Twice-daily (AM & PM) temperatures per unit, out-of-range warnings, corrective actions |
| 🍳 Cooking checks | What came out of the oven, how many, core temp (75°C rule), corrective actions |
| ⚠️ Allergen Guide | Searchable product list with the 14 UK allergens — contains / may-contain / notes |
| 🚚 Delivery checks | Supplier, van/chilled/frozen temps, packaging & date checks, accept/reject with reason |
| 🧽 Cleaning checklists | Opening & closing task lists, ticked off per staff member |
| 🌡️ Probe calibration | Weekly iced-water / boiling-water probe accuracy checks |
| 📖 Diary | Any day's full record, grouped by module — the "show the inspector" page |
| ⚙️ Settings | Add/remove fridges & freezers (with target ranges), staff, cleaning tasks, suppliers |

**Design principles**

- **No logins.** Staff tap their name at the point of task — accountability without passwords.
- **Offline-first.** Every entry saves instantly to an on-device queue (IndexedDB) and syncs
  to Supabase when there's internet. An amber "unsynced" badge shows anything still queued.
- **Append-only evidence.** Log records can never be edited or deleted (enforced by database
  row-level security), and each row stores both when it was recorded and when it synced —
  no back-filling, which is exactly what EHOs distrust about paper diaries.
- **Config is soft-deleted.** Removing a fridge/staff member/task hides it but keeps history intact.

## Go-live checklist (~15 minutes)

### 1. Create the database (Supabase, free)

1. Sign up at [supabase.com](https://supabase.com) → **New project** (any name, EU West region).
2. When it's ready, open **SQL Editor** and run, in order:
   - the contents of `supabase/migrations/0001_init.sql`
   - the contents of `supabase/migrations/0002_full_diary.sql`
   - the contents of `supabase/seed.sql` (starter staff/units/tasks — edit in-app later)
   - the contents of `supabase/migrations/0003_grants_and_units.sql` (API grants — required)
3. Go to **Settings → API** and copy two values:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key

### 2. Configure the app

Put those two values in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

Test locally: `npm run dev`, open http://localhost:3000, log a fridge check, and confirm the
row appears in Supabase (Table Editor → fridge_temp_logs).

### 3. Deploy (Coolify on Hetzner)

1. Push this repository to GitHub.
2. In Coolify: **+ New → Application** → this GitHub repo, branch `master`,
   **Build Pack: Dockerfile**, port `3000`.
3. Add three environment variables and mark each one as a **Build Variable**
   (they're inlined at build time): `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_ADMIN_PIN`.
4. Deploy. Coolify's auto-generated domain works out of the box; a custom
   subdomain can be pointed at it later.

### 4. Put it on the iPad

Open the URL in Safari → Share → **Add to Home Screen**. It installs like an app,
works full-screen, and keeps queueing entries even when the wifi drops.

> **Note:** Supabase free-tier projects pause after ~1 week of inactivity. Daily use keeps it
> alive; if it ever pauses, restore it from the Supabase dashboard in one click.

## Development

```bash
npm run dev     # dev server on :3000
npm run lint    # eslint
npx tsc --noEmit# typecheck
npm run build   # production build
```

Stack: Next.js (App Router) · Tailwind 4 · Supabase (Postgres + RLS) · IndexedDB outbox for
offline sync · PWA (installable, app-shell cached by a service worker in production).
