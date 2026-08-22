# NEXUS OS — Executive Dashboard

The dealership's single screen. Fourteen screens over one Supabase project and
one n8n instance, built as a vanilla-JS Vite bundle with no framework.

> **Note, 22 Aug 2026.** An earlier version of this file documented a REST API at
> `/api/v1/dashboard`, `/api/v1/dashboard/ask`, `/api/v1/dashboard/forecast` and
> `/api/health`. **No such API exists and none was ever built.** The dashboard
> talks to Supabase over PostgREST and to n8n over webhooks, directly from the
> browser. That table is removed rather than left standing, because a README that
> describes endpoints nobody can call is worse than no README.

---

## What it actually talks to

**Supabase** (`dsvuoovivysszdoiorch`) over PostgREST, with the signed-in user's
JWT. Reads are governed by RLS: `authenticated` can read what the dashboard
needs and `anon` can read nothing.

The bundle has exactly **one write helper** — `dbWrite` in `lib/data.js` — and it
is called from exactly two places:

| caller | what it writes |
|---|---|
| `lib/unit-form.js` | `inventory` — create, edit, delete a unit |
| `lib/lead-drawer.js` | `leads.assigned_to_id` — assign a lead to a rep |

Everything else on screen is read-only. `kyc_documents`, `rag_documents`,
`finance_quotes` and `users` are deliberately **not writable from the browser** —
those are service-role paths through n8n.

**Supabase Storage** for archived KYC documents, through
`signedUrl()` in `lib/data.js`. The `kyc-documents` bucket is private; a member
of staff gets a 60-second signed URL, `anon` gets nothing. No public URLs, no
service-role key in the bundle.

**n8n** over seven webhooks, listed in `HOOK` in `lib/data.js`:

| `HOOK.*` | path | screen |
|---|---|---|
| `askAi` | `ask-ai` | Ask AI |
| `finance` | `finance-calc` | Finance |
| `warmDrip` | `lead-trigger` | Campaigns, Leads |
| `closedWon` | `deals/closed-won` | Deals |
| `kyc` | `audit-kyc` | Compliance |
| `erpSync` | `erp-sync` | Automation |
| `escalation` | `lead-escalation` | Leads |

Each call carries the user's Supabase JWT so the workflow can verify a real
session. **No screen may invent a webhook path.** A feature that needs an
endpoint which does not exist ships as a *disabled* control whose `title` names
exactly what is missing.

---

## Layout

```
app.js            128 lines — boot, auth, router over the SCREENS registry
lib/              13 modules — data, dom, format, states, nav, ui, modal,
                  prefs, env, lead-drawer, unit-form, deal-form, integrations
screens/          14 modules — one per screen, one owner each
styles.css        the entire design system. Screens add no CSS.
```

A screen may **only** edit its own file. Shared behaviour belongs in `lib/`.

---

## The two gates — run both

They catch different classes of failure, and neither substitutes for the other.

### `npm run gate` — does it render?

Static lint plus a headless Chromium pass over all 14 screens. Fails on:

- `Math.random()`, raw `fetch()`, inline `<style>`, direct `localStorage`,
  remote imports, or a missing `SCREENS.<id>` registration
- any page error, any screen stuck in a skeleton, any screen in its error state,
  a nav that does not register all 14

It stubs every PostgREST response with a fixed `200` and a fake row. That is
deliberate — it makes the render deterministic — but it means **the gate cannot
tell you whether your query is valid**.

### `npm run probe` — will the database accept it?

```
NEXUS_ENV=/path/to/.env npm run probe
```

Pulls every `db()` path out of the screen sources and runs each against the real
database with `limit=1`, then checks every `HOOK.*` resolves to a webhook
`workflow_registry` actually has registered and active. It does not care how many
rows come back — only that PostgREST accepts the query.

This exists because the render gate was not enough. `team.js` once selected
`leads.lead_score`; that column does not exist, PostgREST rejected the whole
request with `42703`, and the roster lost its per-rep counts in production while
the gate reported clean.

Needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the env file. Service
role is used on purpose — this checks the *shape* of the query; RLS is verified
separately. **Never commit that file.**

---

## Running it

```
npm install
npm run dev
```

`.env` (not committed) needs:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_N8N_BASE_URL=
```

A missing `VITE_N8N_BASE_URL` is a recoverable condition: the workflow-backed
controls disable themselves and say why, and the rest of the app works.

Chromium for the gate comes from `PLAYWRIGHT_BROWSERS_PATH` if it is set;
otherwise `npx playwright install chromium`.

---

## The two standing rules

1. **Never render a number the database did not produce.** No placeholder
   figures, no `Math.random()`, no "example" data. An empty table is an empty
   table and must say so.
2. **Every panel has four states** — loading, error, empty, loaded — and they are
   different states. "Failed to load" and "nothing here" are opposite findings
   and must never look alike.
