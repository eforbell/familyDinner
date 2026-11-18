# Recipe text import validation

Validated locally on 2026-11-17. No real model call or API key was used.

## Automated checks

- `npm test` against disposable PostgreSQL 17: **98 passed, 0 failed, 0 skipped**.
- Model-mocked HTTP tests cover prompt reuse, configured `gpt-5.4-mini` request,
  strict response schema, raw multiline text preservation, source metadata clearing,
  audit persistence, input/type/size validation, missing key, partial drafts,
  refusals, malformed/truncated replies, network failures, and URL/JSON-LD regressions.
- Editor tests execute the browser script with a minimal DOM harness: source switching,
  request payloads, editable fields/import linkage, validation, retries, busy state,
  cancellation, and stale-response isolation.
- A real-PostgreSQL test imports, edits, saves, fetches, and checks the audit linkage.
- Tailnet role tests deny both URL and text imports to kids.
- `node --check server.js`, `node --check public/admin-recipes.js`, and `git diff --check` pass.
- No dedicated lint, typecheck, or build scripts exist in this vanilla-JS repository.

## Database compatibility

Used a disposable Docker database, never the configured household database.

1. Bootstrapped the current `db/schema.sql` through `npm run db:migrate`.
2. Verified fresh text audit records can store a null source URL.
3. Re-established the previous NOT NULL constraint with an existing URL-import row,
   removed only migration 008's marker, then ran the migration runner.
4. Verified `information_schema.columns.is_nullable = YES` and the existing URL row
   was preserved. Import → save → audit linkage passed afterward.

## Browser smoke checks

Playwright drove the actual app/server and PostgreSQL, with only outbound model
requests mocked. Passed:

- 13,000-character input is retained, counted, and rejected without truncation.
- Upstream errors retain the paste and return focus to it for retry.
- Busy state disables Save and keeps keyboard focus in the modal; Tab stays inside.
- Successful import fills the editor; an edited title saves and reloads correctly.
- Pasted text never acquires a fabricated source URL.
- Closing/reopening during an import cannot let a late response overwrite a new draft.
- Focus returns to the recipe card after closing its editor.
- Desktop (1440×1000) and mobile (390×844) screenshots were inspected.
- Mobile has no horizontal overflow and Save remains reachable by scrolling.
- No uncaught browser JavaScript errors. An expected HTTP 500 was logged for the
  deliberately mocked upstream-failure case.

## Claude review

Ran the local advisor via `omx ask claude`. Addressed its blocking findings:

- Removed `maxlength` to avoid silent paste truncation; added a count and validation.
- Preserved focus during imports, on retry, and when returning to a recipe card.
- Kept the status region present and changed its text for announcements.
- Allowed partial ingredient/step drafts with a review warning; unusable drafts and
  truncated responses now receive explanatory errors.
- Ignored Escape during IME composition.

The editor retains its existing explicit Cancel/Escape/backdrop dismissal semantics;
this feature does not add persistent unsaved drafts or a new confirmation flow.
Browser cancellation prevents stale UI updates but does not guarantee cancellation
of an already-running server/model operation.

## Remaining validation limit

Actual extraction quality is not assessed by mocked model responses. An optional
production smoke check with the already-configured model can confirm taste/formatting
quality; no local API-key setup is needed to run this suite. Nothing was deployed.
