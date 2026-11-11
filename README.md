# Alpago IT Portal

Internal IT portal for Alpago Group: asset inventory, helpdesk tickets, employee self-service, software licenses and administration.

**Stack:** Node.js 22 + Express 5, PostgreSQL, vanilla JS single-page frontend (no build step). Everything is open source and self-hostable.

## Features

| Module | What it does |
|---|---|
| **Dashboard** | KPIs with month-on-month change, open tickets by priority, assets by category, quick actions, recent tickets, alerts (warranty expiry, license renewals, pending approvals, stale high-priority tickets, unassigned tickets) |
| **Assets** | Search/filter/sort, add & edit, assign/reassign, return to stock, transfer between entities/locations/holders, retire/delete, full history timeline, linked tickets, CSV export |
| **Tickets** | Create, assign technicians, change status/priority/category, public comments and internal notes, approval workflow for asset/software/onboarding/transfer requests, requester confirm/reopen, CSV export |
| **My Requests (employee portal)** | Assigned equipment and software, request history, one-click forms: Raise a Ticket, Request Asset, Request Software, Report an Issue, Asset Transfer, Onboarding Request |
| **Employees** | Directory with filters, profile with equipment/licenses/tickets, add/edit, assign an in-stock asset directly |
| **Software & Licenses** | Seat usage, cost, renewal countdown, assign/release seats |
| **Reports** | Tickets opened vs resolved, resolution time, assets by entity/value, technician workload, software spend — each downloadable as CSV |
| **Admin** | User accounts (role, enable/disable sign-in, set password), company entities, roles & permission matrix, audit log |

### Default roles

| Role | Access |
|---|---|
| Administrator | Everything (cannot be edited or deleted; the last active admin can't be demoted) |
| IT Technician | Assets, all tickets, internal notes, licenses, employee directory, reports |
| Manager | Approves IT requests, read-only assets/licenses/employees, reports |
| Employee | Own dashboard, own equipment and requests |

Roles and permissions are fully editable in **Admin → Roles & Permissions**; you can create new roles (e.g. HR Officer).

Seeded entities: Alpago Group, Alpago Design and Build, Alpago Properties, Alpago Facility MGT, Alpago Manufacturing (add more under **Admin → Company Entities**).

## Deploy to Render

1. Push this folder to a GitHub (or GitLab/Bitbucket) repository.
2. In Render: **New → Blueprint**, pick the repo. Render reads `render.yaml` and creates:
   - `alpago-it-portal` web service (Node, Frankfurt)
   - `alpago-it-db` PostgreSQL database, wired in through `DATABASE_URL`
   - a random `JWT_SECRET`
3. When prompted, enter `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the first administrator.
4. Click **Apply**. On first start the app creates the tables, roles, permissions, entities and your admin account.
5. Open the `.onrender.com` URL, sign in, and change the admin password (user menu → Change password).

**Plans:** the blueprint uses `0.5c-512mb` for the web service and `basic-256mb` for Postgres. You can switch both to `free` for a trial, but free web services sleep after 15 minutes idle and free Postgres databases expire after 30 days (then are deleted after a 14-day grace period) — don't keep real data on them.

**Region:** Frankfurt. Singapore is the other region reasonably close to the UAE; change `region` on both entries if you prefer it (it must match for the internal connection).

**Demo data:** set `SEED_DEMO=true` before the first deploy to load ~120 sample assets, 60 tickets and 9 licenses (only runs when the assets table is empty). Demo logins use the password `Demo@2026`: `tech1@alpago.local`, `manager@alpago.local`, `employee@alpago.local`. Delete or disable these users before going live.

**Custom domain:** in the web service → Settings → Custom Domains (e.g. `it.alpago.ae`); Render issues the TLS certificate.

## Run locally

```bash
cp .env.example .env        # edit DATABASE_URL etc.
npm install
npm run dev                 # http://localhost:3000
```

Needs a local PostgreSQL 14+. To use the Render database from your machine, use its *external* connection string and set `PGSSL=true`.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `JWT_SECRET` | yes (prod) | Long random string; changing it signs everyone out |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | first start | Bootstrap admin, created only if that email doesn't exist |
| `ADMIN_NAME` | no | Display name for the bootstrap admin |
| `JWT_EXPIRES` | no | Session length, default `12h` |
| `SEED_DEMO` | no | `true` to load sample data once |
| `PGSSL` | no | `true` when connecting over Render's external URL |

## Project layout

```
server.js               Express app, security headers, static hosting
src/schema.sql          Database schema (idempotent; runs on every start)
src/migrate.js          Schema + roles/permissions/entities/admin bootstrap
src/permissions.js      Permission keys and default roles
src/routes/*.js         REST API (auth, assets, tickets, employees, licenses, admin, dashboard/reports)
public/                 Frontend SPA (index.html, css/app.css, js/views/*)
render.yaml             Render Blueprint
```

## Security notes

- Passwords hashed with bcrypt; login is rate-limited (20 attempts / 15 min per IP).
- Every API route checks permissions server-side; employees only see their own assets and tickets.
- Internal ticket notes are never sent to users without the `tickets.internal_notes` permission.
- License keys are masked for users without `licenses.manage`.
- All create/update/delete actions are written to the audit log.
- Back up the database: paid Render Postgres plans include daily backups; you can also `pg_dump` the external URL.
