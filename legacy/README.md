# FamilySearch GEDCOM Compare

Local-first tooling to compare a GEDCOM file against read-only FamilySearch tree data gathered through a normal logged-in browser session.

See `PROJECT_CHECKLIST.md` for the current end-to-end plan and implementation checklist.

## Current Architecture

The current approach is an extension-first workflow:

- The user logs in, handles 2FA, and browses FamilySearch in a normal browser session.
- The extension icon opens the Angular app page at `app/index.html#/gedcom`.
- The extension captures read-only data from visible FamilySearch person pages.
- The extension can navigate direct FamilySearch person URLs discovered from visible relatives.
- The Angular extension page currently supports GEDCOM upload/import and will grow into mapping, traversal controls, and comparison results.
- JSON will be the working format for both GEDCOM imports and FamilySearch snapshots.

Note: an early browser spike showed that FamilySearch blocks Playwright-launched Chrome sessions and other automation-style profile/flag setups, so that approach has been removed.

## Scripts

```sh
nvm use
npm install
npm run extension:build
npm run extension:check
npm run gedcom:convert -- --input "Wilson Family Tree.ged"
npm run typecheck
```

The project uses Angular 22 and includes an `.nvmrc` for Node 22.22.3.

`npm run extension:build` builds the Angular app into `extension/familysearch-collector/app`, keeping `extension/familysearch-collector/manifest.json` at the extension root for Chrome's Load unpacked flow.

`npm run gedcom:convert -- --input "Wilson Family Tree.ged"` writes normalized GEDCOM JSON to `.local/gedcom.normalized.json`.

`npm run typecheck` currently runs an esbuild-based TypeScript entrypoint build check because `tsc --noEmit` has been hanging in this local Node/tooling environment.

## Extension Collector

The local WebExtension prototype lives in `extension/familysearch-collector`.

- Load it unpacked in Chrome from `chrome://extensions`.
- Log in and browse FamilySearch normally.
- Click the extension icon to open the Angular app page.
- Use the GEDCOM upload page to import a `.ged` file locally.
- Open a person details page when you are ready to capture or compare FamilySearch data.
- Export captured pages as JSON for the GEDCOM comparison engine.
