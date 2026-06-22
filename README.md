# Evoke Organogram

An interactive organisation hierarchy that runs entirely in the browser — no
server, no build step, no dependencies. Drill from the top of the company down
through departments, sections, and people; search anyone; reassign people; and
edit the roster. Built to be **edited, expanded, and deployed to GitHub Pages**
so management can open one link and explore.

---

## What's in here

```
evoke-organogram/
├── index.html              # the page (loads everything below)
├── css/
│   └── styles.css          # all styling
├── js/
│   ├── config.js           # branding + the drill hierarchy + edit settings
│   └── app.js              # all the logic
├── data/
│   └── employees.js        # YOUR DATA — one record per line
├── .github/workflows/
│   └── deploy.yml          # auto-publishes to GitHub Pages on every push
├── .nojekyll               # tells Pages to serve files as-is
└── README.md
```

---

## Deploy to GitHub Pages (one time, ~3 minutes)

1. Create a new repository on GitHub (e.g. `evoke-organogram`).
2. Upload **all** of these files/folders to it (drag the whole folder into
   GitHub's "upload files", or use `git` — see below).
3. In the repo, go to **Settings → Pages**.
4. Under **Build and deployment → Source**, choose **GitHub Actions**.
   (The included `deploy.yml` workflow does the rest. If you prefer, you can
   instead pick **Deploy from a branch → main → / (root)**.)
5. Wait for the green check on the **Actions** tab, then open the URL Pages
   gives you, e.g. `https://<your-username>.github.io/evoke-organogram/`.

Share that link with management — it opens **read-only** by default.

### Using git instead of the web uploader
```bash
git init
git add .
git commit -m "Initial organogram"
git branch -M main
git remote add origin https://github.com/<you>/evoke-organogram.git
git push -u origin main
```

---

## Two access modes

| Link | Who | Can do |
|------|-----|--------|
| `.../evoke-organogram/` | Management | View, drill, search, export |
| `.../evoke-organogram/?edit=1` | You | Everything above **plus** add / edit / move people and change the hierarchy |

This is controlled in `js/config.js`:

```js
allowEditing:  true,    // master on/off for all editing tools
editByDefault: false    // false = plain link is read-only; ?edit=1 unlocks
```

Set `editByDefault: true` if you want everyone who opens the link to edit.

---

## Editing the data

You have two ways, and they meet in the middle.

**A. In the app (recommended).** Open the `?edit=1` link.
- **＋ Add** creates a new person.
- **Edit** on any card changes their details, or removes them.
- **Move** drag a person's card onto a department in the left sidebar, or use the
  "Move…" dropdown on the card.
- Your changes are kept in your browser as you go (a yellow banner appears).
- When ready, **Export → `data/employees.js`**, then replace that file in the
  repo and commit. The live site updates for everyone. Done.

**B. By hand.** Open `data/employees.js` and edit the array directly — it's just
one record per line. Commit. That's it.

> The browser draft is local to your machine only. **Exporting + committing
> `employees.js` is what publishes changes to everyone.** Use **Discard** in the
> banner to throw away local edits.

---

## Expanding the hierarchy (multiple levels)

The drill path is defined in `js/config.js`:

```js
hierarchy: ["department", "section"]
```

The individual employee is always the final level. You can use any of these
fields, in any order, with as many levels as you like:

`department`, `section`, `business_area`, `company`, `position`

Examples:
```js
hierarchy: ["company", "department", "section"]      // 3 levels
hierarchy: ["business_area", "department"]            // group by location first
hierarchy: ["department"]                             // shallow
```

You can also change this **live** in the app: open `?edit=1`, click
**⚙ Hierarchy**, reorder / add / remove levels, then **Export → `js/config.js`**
and commit to make it the default.

### Adding a brand-new field as a level
1. Add the field to every record in `data/employees.js` (e.g. `"team": "..."`).
2. Add it to `fields` in `config.js` with `group: true`:
   ```js
   { key: "team", label: "Team", group: true }
   ```
3. Add `"team"` wherever you want it in `hierarchy`.

---

## Customising look & labels

In `js/config.js`:
- `orgName`, `subtitle` — header text.
- `accent` — the signature colour (hex).
- `cardChips` — which fields show as little tags on each person's card.

Deeper styling lives in `css/styles.css` (colours are CSS variables at the top).

---

## How "lead" is decided

There's no manager column in the source data, so the senior-most person in each
group is inferred from their job title (Chairman → CEO → GM → Manager →
Executive → Supervisor → trades → support roles) and flagged as the lead. If you
later add a real "reports to" / manager field, this can be upgraded to true
reporting lines — the ranking logic lives near the top of `js/app.js`.

---

## Notes

- Works offline too: just open `index.html` in a browser.
- No analytics, no external calls except Google Fonts (which degrades gracefully
  if blocked).
- Tested in current Chrome, Edge, Firefox, and Safari.
