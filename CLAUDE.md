# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Family dinner "what's for dinner tonight?" app — LAN-hosted on a Linux server. Kids get a link, see tonight's meal. Weeks are planned explicitly on the Plan page (`/plan`); a legacy 3-week rotation template survives only as an autofill source.

Family: Eric (Dad, main cook), Alex (Mom, project meals when energy allows — she has cancer, so energy flagging matters), Son (hates leftovers), Daughter (picky eater).

## Dev Commands

```bash
npm install          # first time
npm run dev          # node --watch (Node 18+, no nodemon needed)
npm start            # production

# Database setup (run once on a new Postgres instance)
npm run db:migrate
# then open the browser setup flow to create household members / starter settings
```

Copy `.env.example` to `.env` and fill in `DATABASE_URL`.

## Architecture

Single-process Node.js/Express app, no build step.

```
server.js          # Express app — all routes inline
db/
  schema.sql       # CREATE TABLE statements
  migrate.js       # Migration runner
  migrations/      # Numbered SQL migrations
  seed.sql         # Legacy/dev sample data; browser setup is canonical first-run path
public/
  index.html       # Main app shell
  style.css        # Dark theme, mobile-first, CSS custom properties
  app.js           # All client-side logic (vanilla JS, no framework)
```

### Key Data Model Concepts

- **plan_days** — canonical per-date meal plan (`plan_date` PK → `meals.id`). All week/tonight reads resolve from here; nothing falls back to the rotation at runtime.
- **meal_rotation** — 21-row template (3 weeks × 7 days). Only consumed by the Plan page's "Fill from rotation" autofill and per-day suggestions.
- **daily_overrides** — retired; data preserved but no longer read (migration 006 folded it into `plan_days`).
- **app_config** `rotation_start_date` — a Monday; template week is computed as `weeks_since_start % 3` so autofill knows which template week matches a calendar week
- **val_energy** — weekly energy level (1–5) for suggesting project vs. easy meals
- **meal_votes** — scoped to `week_context` (Monday of the week), one reaction per person per meal per week

### Server Routes

| Route | Purpose |
|-------|---------|
| `GET /tonight` | Simple HTML display page — for Raspberry Pi / home screen shortcut |
| `GET /api/tonight` | JSON for integrations |
| `GET /api/week` | Full week resolved from `plan_days` |
| `GET /api/plan?week_start=` | Week plan + per-day rotation suggestions (Plan page) |
| `PUT /api/plan/day` | Set/clear one day (`{ date, meal_id\|null }`) |
| `POST /api/plan/autofill` | Fill empty days (`{ week_start, source: rotation\|previous_week }`) |
| `PUT /api/swap` | Legacy alias — sets a day's meal in `plan_days` |
| `DELETE /api/swap/:date` | Clear the day |
| `POST /api/vote` | React to a meal (`{ meal_id, member_id, reaction }`) |
| `POST /api/energy` | Mom's weekly energy flag (`{ energy_level: 1-5 }`) |
| `POST /api/log` | Record what actually got cooked |

### Frontend State

Member identity persists in `localStorage` as `fd_member`. On first visit, a member picker overlay appears. All vote calls include the stored `member_id`.

### Rotation Week Calculation

`rotationWeek()` in `server.js`: count full weeks since `rotation_start_date`, mod 3, 1-indexed. Handles negative offsets (if start date is in the future).

## Meals

The meal library is the picker's source (`GET /api/meals?q=` supports server-side search). Protected meals (`is_protected = true`, e.g. `Thursday Night Out`) render as order-in nights and are excluded from the picker. `public/meal-picker.js` is the shared searchable picker used by the Week page swap and the Plan page.

## Deployment Notes (Linux LAN)

```bash
npm install --omit=dev
node server.js         # or use pm2 / systemd

# Systemd example
# ExecStart=/usr/bin/node /path/to/familyDinner/server.js
# Environment=DATABASE_URL=postgresql://...
# Environment=PORT=3000
```

The app binds to `0.0.0.0` so it's reachable from any device on the LAN.
