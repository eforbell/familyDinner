# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Family dinner "what's for dinner tonight?" app — LAN-hosted on a Linux server. Kids get a link, see tonight's meal. Built on a 3-week rotating menu from `family_menu.docx`.

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

- **meal_rotation** — 21-row template (3 weeks × 7 days), references `meals.id`
- **daily_overrides** — per-date meal swaps; takes precedence over rotation
- **app_config** `rotation_start_date` — a Monday; rotation week is computed as `weeks_since_start % 3`
- **val_energy** — weekly energy level (1–5) for suggesting project vs. easy meals
- **meal_votes** — scoped to `week_context` (Monday of the week), one reaction per person per meal per week

### Server Routes

| Route | Purpose |
|-------|---------|
| `GET /tonight` | Simple HTML display page — for Raspberry Pi / home screen shortcut |
| `GET /api/tonight` | JSON for integrations |
| `GET /api/week` | Full week with overrides resolved |
| `PUT /api/swap` | Override a day's meal (body: `{ date, meal_id }`) |
| `DELETE /api/swap/:date` | Restore rotation default |
| `POST /api/vote` | React to a meal (`{ meal_id, member_id, reaction }`) |
| `POST /api/energy` | Mom's weekly energy flag (`{ energy_level: 1-5 }`) |
| `POST /api/log` | Record what actually got cooked |

### Frontend State

Member identity persists in `localStorage` as `fd_member`. On first visit, a member picker overlay appears. All vote calls include the stored `member_id`.

### Rotation Week Calculation

`rotationWeek()` in `server.js`: count full weeks since `rotation_start_date`, mod 3, 1-indexed. Handles negative offsets (if start date is in the future).

## Meals

17 meals in the rotation. 7 marked `is_new = true` (★ NEW in the doc). 1 protected (`Thursday Night Out`, `is_protected = true`) used for all three Thursday slots. Meals shared across weeks (e.g., Carne Asada Tacos appears in W2 Mon and W3 Tue) reference the same `meals.id`.

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
