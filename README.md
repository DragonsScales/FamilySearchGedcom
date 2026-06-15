# FamilySearch GEDCOM Compare

Local-first Angular/WebExtension tooling to compare a GEDCOM file against read-only FamilySearch tree data gathered through a normal logged-in browser session.

See `PROJECT_CHECKLIST.md` for the current end-to-end plan and implementation checklist.

## Current Architecture

- The user logs in, handles 2FA, and browses FamilySearch in a normal browser session.
- The Chrome extension action opens the Angular app page at `index.html#/gedcom`.
- The Angular app uses hash routing so extension URLs work without server fallback.
- The GEDCOM upload page parses and stores normalized GEDCOM JSON locally in extension storage.
- The results page currently shows GEDCOM-only review cards, with room for FamilySearch and Other comparison columns later.
- The extension background worker and content script remain read-only and user-controlled.
- Playwright was removed because FamilySearch blocked Playwright-launched/custom automation browser sessions.

## Scripts

```sh
nvm use
npm install
npm run extension:build
npm run extension:check
npm run gedcom:convert -- --input "Wilson Family Tree.ged"
npm run typecheck
```

`npm run extension:build` builds the Angular app into `extension/familysearch-collector`. Load that folder unpacked in Chrome.

`npm run gedcom:convert -- --input "Wilson Family Tree.ged"` writes normalized GEDCOM JSON to `.local/gedcom.normalized.json`.

## Extension Install

1. Run `npm run extension:build`.
2. Open `chrome://extensions`.
3. Enable Developer Mode.
4. Click Load unpacked.
5. Select `/Users/Riley/Repos/FamilySearchGedcom/extension/familysearch-collector`.
