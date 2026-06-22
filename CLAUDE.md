# CLAUDE.md

Project memory for Claude Code. Read this before making changes.

## What this is

An interactive **organisation hierarchy (organogram)** for Evoke, ~1,600 employees.
Pure static site — **vanilla HTML/CSS/JS, no framework, no build step, no package
manager, no dependencies**. Ships to GitHub Pages. Users drill from the top of the
company down through configurable levels (default Department → Section → person),
search anyone, reassign people, and edit the roster from the browser.

Keep it dependency-free and build-free. Do not introduce npm, bundlers, TypeScript,
React, or a server runtime. If a change seems to "need" a build step, reconsider.

## Run & test

```bash
# Serve locally — REQUIRED. Do not open index.html via file:// (fetch/relative
# paths and the data file won't load; you'll see "0 Employees" and unstyled boxes).
python -m http.server 8000      # then open http://localhost:8000

# Browser smoke test (Playwright). Spins up the page, drills, edits, exports.
# Asserts employee count, drill depth, add-person, dirty banner, and export output.
python /tmp/test.py             # see "Testing" below to recreate
```

There is no lint/build/CI for the app itself. The only automation is
`.github/workflows/deploy.yml`, which publishes the repo to GitHub Pages on push to
`main`. Don't add a build step to that workflow — it uploads the repo as-is.

## File map

| Path | Role |
|------|------|
| `index.html` | Shell. Loads, in order: `data/employees.js`, `js/config.js`, `js/app.js`. Holds the static DOM for header, sidebar, modals, toast. |
| `js/config.js` | **The knobs.** Branding, the drill `hierarchy`, field definitions, card chips, and the editing switches. Most "settings" changes happen here. |
| `data/employees.js` | **The data.** Assigns `window.EVOKE_DATA = [...]`, one record per line. Plain `.js` (not `.json`) on purpose — see "Why .js". |
| `js/app.js` | **All logic** in one IIFE: render, drill/breadcrumbs, search, reassign, editor, hierarchy editor, export, seniority ranking. |
| `css/styles.css` | All styling. Colours are CSS variables in `:root` at the top. |
| `.nojekyll` | Tells GitHub Pages to serve files as-is (don't delete). |
| `.github/workflows/deploy.yml` | Auto-deploy to Pages on push to `main`. |

## Data model

Each record has these string fields (also the column order for CSV):
`emp_no`, `name`, `position`, `department`, `section`, `business_area`, `company`.
At runtime each record also gets a transient `_id` (array index) — **never persist
`_id`**; `strip()` removes it before any export. Empty/missing values render as `—`.

## Key concepts (read before editing app.js)

- **Config-driven hierarchy.** `CFG.hierarchy` is an ordered array of field keys,
  e.g. `["department","section"]`. The app groups by `hierarchy[depth]`; the
  individual employee is always the implicit final leaf. State lives in `path` (an
  array of `{field, value}`). `currentField()` returns `hierarchy[path.length]` or
  `undefined` (= show employee cards). Changing the hierarchy is data-agnostic —
  don't hardcode "department"/"section" anywhere in render logic.

- **Two access modes via one URL.** Read-only by default; `?edit=1` unlocks editing.
  Gate: `EDIT = allowEditing && (editByDefault || url has edit=1)`. When false,
  `body.readonly` hides every `.edit-only` element via CSS. Any new editing
  affordance must carry the `edit-only` class and be guarded by `if (EDIT)` in JS.

- **Edit → export → commit loop.** Edits mutate the in-memory `EMP` array and are
  autosaved to `localStorage` (`evoke_org_draft_v1`) as a per-browser draft, with a
  "unsaved edits" banner. Drafts are local only. **Publishing = Export
  `data/employees.js` → replace the file → commit.** `committedSnapshot` (JSON of
  the file data) drives the `dirty()` check. Don't treat localStorage as the source
  of truth; the committed file is.

- **Seniority / "lead".** There is **no manager/reports-to field** in the data.
  The senior-most person per group is *inferred* from job title via the `RANKS`
  regex table near the top of `app.js` (`rank()` / `bySeniority()`), and flagged as
  "Lead". These are structural lines, not real reporting lines. If a real manager
  field is added later, that's where to upgrade to true reporting hierarchy.

- **Export formats.** `employees.js` (one record per line — keep this format for
  clean Git diffs), `employees.csv`, `employees.json`, and `config.js` (writes the
  live hierarchy back out). All go through `download()`.

## Why `.js` not `.json` for data

`data/employees.js` is loaded with a `<script>` tag so it works on `file://` and on
Pages without `fetch()` (which 404s on `file://`). Keep data as a `window.EVOKE_DATA`
assignment, one record per line. If you ever switch to `fetch('data/x.json')`, the
local `file://` workflow breaks — only do it knowingly.

## Conventions

- Vanilla ES (template literals, no transpile). No external libs except Google Fonts
  (degrades gracefully if blocked).
- **Always escape interpolated data** with `esc()` before putting it in HTML, and
  `cssEsc()` inside attribute selectors. User/data text is untrusted.
- CSS: 2-space indent, colours via the `:root` variables, no inline styles except
  dynamic per-record colours.
- Keep `app.js` as one self-contained IIFE. No globals beyond `window.EVOKE_DATA`
  and `window.ORG_CONFIG`.
- Don't store secrets/PII beyond the employee roster already in the repo.

## Common tasks

- **Change branding / accent:** `js/config.js` → `orgName`, `subtitle`, `accent`.
- **Add a hierarchy level from an existing field:** add the field key to
  `CFG.hierarchy` (or use the in-app ⚙ Hierarchy panel, then Export config).
- **Add a brand-new field (e.g. `team`):** add `"team": "..."` to every record in
  `data/employees.js`; add `{ key:"team", label:"Team", group:true }` to
  `CFG.fields`; then it's available for `hierarchy` and the editor.
- **Make the link editable for everyone:** `editByDefault: true` in config.
- **Adjust seniority logic:** edit the `RANKS` table in `app.js` (ordered, first
  match wins; more specific patterns must come before generic ones, e.g.
  `senior manager` before `manager`).

## Gotchas

- Opening from a zip or via `file://` shows unstyled boxes and `0 Employees` —
  that's missing sibling files, not a bug. Serve over HTTP.
- Hidden files (`.nojekyll`, `.gitignore`, `.github/`) are easy to miss when
  uploading via drag-and-drop; the site works without them but auto-deploy needs
  `.github/` and Pages prefers `.nojekyll`.
- `RANKS` order matters; reordering can silently change which person is "Lead".
- The horizontal connector line under a parent is positioned by `adjustBar()` after
  render and on resize — if you change `.children`/`.child` layout, re-check it.

## Testing (recreate the smoke test)

Use Playwright (Chromium) against `http://localhost:8000`. Cover: read-only hides
edit controls; counts render (1,608 employees / 29 departments by default); drilling
Department → Section → people; `?edit=1` shows Add/Hierarchy; adding a person bumps
the count and raises the dirty banner; Export `employees.js` output contains the new
record; search jumps to and highlights a person. Assert **zero `pageerror`s**.
