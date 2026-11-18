# Design

## Source of truth
- Status: Active; refreshed 2026-11-17.
- Surfaces: recipe library and Recipe Builder import/editor modal.
- Evidence: `public/admin-recipes.html`, `public/admin-recipes.js`, `public/style.css`, `public/dinner-skin.css`, `public/recipes.html`.

## Brand
Practical, welcoming household tool. Reuse existing styling; avoid a new visual system.

## Product goals
Import an unformatted pasted recipe into an editable draft without disturbing URL import. Success means reviewing and explicitly saving the same fields as existing recipes. No automatic saving, file uploads, or new model/settings controls.

## Personas and jobs
Household cooks collecting recipes from websites, messages, and personal notes, often on a phone.

## Information architecture
Keep browsing separate from building. Recipe Builder → Import recipe → choose Import from URL (default) or Import from text → import → review/edit → Save recipe.

## Design principles
Reuse the existing focused modal and draft editor. Preserve input on errors; never discard a draft because an older request completes. Do not pretend pasted text has a website source.

## Visual language
Reuse existing chassis/skin tokens, fonts, spacing, rounded panels, form fields, and buttons. No new imagery, animation, or custom CSS is needed.

## Components
Add a native import-source select and labeled multiline textarea with a character count inside the existing import panel. URL and text inputs are mutually visible. Reuse import summary, inline errors, recipe fields, and Save/Cancel actions. Existing CSS remains the token/component owner.

## Accessibility
Use native labeled controls and descriptive helper text. Focus the selected source editor, then the title on success; restore the opener on close. Announce progress/errors, expose busy state, and retain Escape/backdrop dismissal. Keep the existing modal keyboard containment with Tab/Shift+Tab. No new motion; inherit existing contrast and reduced-motion rules.

## Responsive behavior
Inherit mobile-first modal sizing and scrolling. Textarea fills the panel on narrow screens; native controls support touch and keyboard.

## Interaction states
- Loading: disable import/source inputs and Save; announce importing. Dismissal cancels the browser request and ignores stale responses.
- Empty: explain that no particular recipe format is required; reject blank input.
- Error/slow network: keep the pasted text and current draft, show an inline error, allow retry or dismissal.
- Success: populate the existing editable fields and import linkage, show text-specific provenance, focus title. Save remains explicit.
- Limits/configuration: accept up to 12,000 characters without silent truncation; explain missing server API configuration rather than return an empty draft. Return partial ingredient/step drafts with a warning so users can complete them before saving.

## Content voice
Short and plain: “Import from URL”, “Import from text”, “Recipe text”, “Review and save”. Do not imply model output is verified.

## Implementation constraints
Vanilla JS/HTML and existing CSS; no new dependencies. Keep relative API paths for subpath deployments, existing parent-only authorization, configured recipe model, response schema, and both editable prompts. Append text-source guidance only on text imports. Never fetch URLs found in pasted text. Clear website/image metadata for pasted text; users can add attribution during review. Nullable import source URL requires migration 008 and fresh-schema parity.

## Test/screenshot expectations
Mock model/network/database boundaries, exercise the actual HTTP handler and browser state, retain URL regression coverage. Inspect desktop/mobile screenshots against the existing modal styling. No live model call or API key is required for validation.

## Open questions
None blocking. Model extraction quality on highly incomplete recipes remains a production smoke-test opportunity.
