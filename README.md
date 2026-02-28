# Family Dinner

Small household dinner-planning app for answering "what's for dinner?", managing a repeating 3-week rotation, voting on meals, and drafting new meal ideas with AI.

## What It Does

- Shows tonight's dinner and the current week plan
- Supports one-off swaps for specific dates
- Supports recurring rotation edits across a 3-week cycle
- Tracks simple family reactions to meals
- Supports order-in nights with restaurant voting
- Lets you manage the meal library from an admin page
- Includes `Magic Meal`, which drafts a new meal idea using meal history, votes, and cook frequency, then lets you review/edit before saving

## Stack

- Node.js
- Express
- PostgreSQL
- Plain HTML / CSS / vanilla JS

No build step. Single-process app.

## Main Routes

- `/` — main dinner app
- `/tonight` — simple tonight-only view
- `/admin` — rotation admin for the repeating 3-week plan
- `/admin/meals` — meal library admin and Magic Meal

## API Highlights

- `GET /api/week`
- `GET /api/tonight`
- `GET /api/rotation`
- `PUT /api/rotation-slot`
- `GET /api/meals`
- `POST /api/meals`
- `PUT /api/meals/:id`
- `DELETE /api/meals/:id`
- `POST /api/vote`
- `POST /api/order-in/:date/vote`
- `GET /api/magic-meal/settings`
- `PUT /api/magic-meal/settings`
- `POST /api/magic-meal`

## Local Run

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000`.

## Environment

Required:

- `DATABASE_URL`

Optional / current production use:

- `PORT`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

For Magic Meal, `OPENAI_API_KEY` must be set. `OPENAI_MODEL=gpt-4o-mini` is a good default.

## Database Notes

There are no migrations required for the current feature set beyond the existing schema files in `db/`.

Important app data:

- `meal_rotation` drives the repeating 3-week plan
- `daily_overrides` stores one-off date swaps
- `meals` is the master meal library
- `meal_votes` stores family reactions
- `cook_log` stores what actually got made
- `app_config` stores app settings such as:
  - `rotation_start_date`
  - `magic_meal_prompt`

## Deployment

This app is currently intended for a simple home-server setup.

Example:

```bash
./deploy/deploy.sh origin/main
```

There is also a sample systemd unit in `deploy/family-dinner.service`.

### Deploy Script Usage

`deploy/deploy.sh` accepts either a single ref or a `remote branch` pair:

```bash
./deploy/deploy.sh
./deploy/deploy.sh origin/main
./deploy/deploy.sh feat/subpath-support
./deploy/deploy.sh origin feat/subpath-support
```

Normal flow on the server:

```bash
git fetch origin
./deploy/deploy.sh origin/main
```

If the deploy script itself changes, `git fetch` alone does not update the checked-out `deploy/deploy.sh` file. In that case, update the checkout to a commit containing the new script once, then resume the normal `fetch + deploy` flow.

### Hosting Under a Subpath

The browser assets and API calls are written to work both at `/` and behind an nginx location prefix such as `/dinner/`.

Example nginx setup:

```nginx
location /dinner/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location = /dinner {
    return 301 /dinner/;
}
```

Important: the trailing slash on `proxy_pass http://127.0.0.1:3000/;` is what strips the `/dinner/` prefix before forwarding to Express.

## Notes

- The 3-week plan repeats forever until you edit `meal_rotation`
- Adding a meal to the library does not automatically add it to the rotation
- Magic Meal drafts ideas but does not save them unless you explicitly save through the meal editor
