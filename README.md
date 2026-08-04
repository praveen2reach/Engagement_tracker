# Engagement Task Tracker

A multi-user implementation task planner: define tasks with a duration, dates
cascade automatically off a project start date (business days, India holiday
calendar aware), the team logs actuals and comments, and the tracker shows
deviation vs. plan plus a ⭐ gold-star highlight on whatever is active this
week.

## How the logic works

- **Cascading dates** — each task has an optional predecessor and a
  dependency type: **FS** (Finish-to-Start — starts the next working day
  after its predecessor ends) or **SS** (Start-to-Start — starts the same day
  as its predecessor, i.e. runs in parallel). Tasks with no predecessor anchor
  to the project's start date.
- **Working days** — weekends are always skipped; dates in the India Holiday
  Calendar (maintained under Admin) are skipped too.
- **Baseline v1** — the first time a task's planned dates are calculated,
  they're frozen as `baseline_start`/`baseline_end`. Later Change Requests can
  shift `planned_start`/`planned_end` freely — Baseline v1 never changes, so
  you can always see slippage since day one alongside slippage since the last
  approved CR.
- **Deviation** — `Actual End − Planned End`, in working days. Green = on
  time/early, amber = 1–2 days late, red = 3+ days late.
- **Current week (⭐)** — any task whose active window (actual dates if
  present, else planned dates) overlaps the current Mon–Sun gets a gold star
  and a highlighted row on the tracker. This is computed live on every page
  load, not stored.
- **Roles** — Admin can add/remove tasks and edit name, sequence,
  predecessor, dependency type, and duration (i.e. anything that reshapes the
  plan — this is where Change Requests get applied). Team members can only
  enter Actual Start/End, Status, and comments. This is enforced **server-side**
  in the API routes, not just hidden in the UI.

## Deploying (Vercel + Postgres)

1. Push this folder to a GitHub repo, then **Import Project** in Vercel.
2. In the Vercel project: **Storage → Create Database**. Vercel now provisions
   Postgres storage through the **Neon** integration (their own `@vercel/postgres`
   package is deprecated but still functional, connecting via the same
   `POSTGRES_URL`). Attaching it auto-populates `POSTGRES_URL` and friends as
   env vars — no code change needed. If Vercel's UI nudges you toward Neon's
   own SDK instead, that's fine too; it's a drop-in swap in `lib/db.js` if you
   ever want to move off `@vercel/postgres`.
3. Add the remaining env vars from `.env.example` (`NEXTAUTH_SECRET`,
   `NEXTAUTH_URL` = your production URL, `ADMIN_EMAIL`, `ADMIN_PASSWORD`).
4. Pull env vars locally (`vercel env pull .env.local`) and run:
   ```
   npm install
   npm run db:init
   ```
   This creates all tables and your first admin login.
5. Deploy. Sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`, go to **Admin
   setup**, create your first engagement (e.g. "Synlab ORC Phase 2"), add
   tasks, and add your team's holiday dates.
6. For team members: create additional rows in the `users` table (or add a
   simple "invite user" admin screen later — not built yet, since you said
   SSO is coming) with `role = 'team'`.

## Adding Company SSO (Phase 2)

`lib/auth.js` uses NextAuth's Credentials provider today so the team can
start immediately. Once your IT team provides an app registration
(Microsoft Entra ID / Azure AD, Okta, or Google Workspace all work the same
way), swap in the matching NextAuth provider — the comments at the top of
`lib/auth.js` show the exact code for each. Nothing else in the app needs to
change: sessions, role checks, and API routes all read from the same
`session.user.role`/`session.user.id`, regardless of which provider signed
the user in.

## What this is *not*

This is a bespoke tool, not an Oracle Fusion HCM module — it doesn't touch
your Oracle instance or use Oracle's Project Financial Management / Task
Management functionality. If you later want implementation tasks tracked
*inside* Oracle itself (e.g. for a client who wants visibility in their own
tenant), that would be a separate conversation about Oracle PPM/Task
Management fit — happy to cover that whenever useful.

## Known limitations / next steps to consider

- No "invite teammate" screen yet — new users are added directly in the
  `users` table until SSO is wired in (at which point anyone in your
  directory can just sign in, and you set their role in the `users` table).
- Holiday calendar is manual and per-calendar-year — needs a yearly top-up.
- No Excel export yet (mentioned earlier as a nice-to-have) — straightforward
  to add with ExcelJS, following the same pattern as your other tools, once
  the core flow is validated with real data.
- No email/Slack notifications for delayed tasks — could be added later via
  a scheduled Vercel Cron function if useful.
