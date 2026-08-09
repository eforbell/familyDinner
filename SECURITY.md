# Security Policy

## Scope and intended deployment

Family Dinner is a small household meal-planning application. It is designed for a trusted LAN or Tailnet behind a reverse proxy. The application does not currently provide full user authentication, so it must not be exposed directly to the public internet.

## Data and integrations

- The database contains household member names, meal preferences, votes, recipes, prompts, and planning history.
- `OPENAI_API_KEY` enables Magic Meal, Magic Grocery, and recipe assistance. Relevant meal and recipe context may be sent to the configured OpenAI model.
- Recipe import retrieves a URL supplied by a user. Its private-address and localhost protections are a security boundary and must remain covered by tests and review.

## Required operating practices

1. Keep the service on a trusted network and proxy it through HTTPS when traffic crosses an untrusted network.
2. Store `DATABASE_URL` and `OPENAI_API_KEY` only in the runtime environment or a gitignored `.env` file.
3. Use a database account limited to this application's database.
4. Do not put secrets, private URLs, or sensitive family information into AI prompts.
5. Recipe import currently validates only the initial URL against localhost/private-address targets. Redirect destinations are not revalidated and no explicit fetch timeout or response-size cap is enforced. Keep the app private and treat redirect validation, bounded streaming, and timeouts as unresolved SSRF/resource-exhaustion controls.
6. Back up the database and test restore procedures. Protect backups as household-private data.

## Known limitation

Selecting a household member is an application preference, not proof of identity. Anyone who can reach the app can potentially read or modify meal data.

## Reporting a vulnerability

Report issues privately through a GitHub Security Advisory when available, or contact the repository owner privately. Do not post credentials or household data in a public issue. Include reproduction steps, impact, and a safe proof of concept.

There is no bug bounty program or guaranteed response SLA.
