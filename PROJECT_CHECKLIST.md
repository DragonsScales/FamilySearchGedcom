# Project Checklist

## End Goal

Build a local-first browser extension that compares a GEDCOM file against the currently viewed FamilySearch tree.

Target user flow:

- Click the extension icon to open the extension's Angular app page.
- Upload or select a GEDCOM file in the extension.
- Open a starting FamilySearch person page in a normal logged-in browser session.
- Click a compare action for the current FamilySearch person.
- Map the current FamilySearch person to the corresponding GEDCOM person.
- Use the GEDCOM relationship graph to decide which branches need to be checked: parents, spouses, children, siblings, and later other supported relationships/events.
- Visit related FamilySearch person pages using direct URLs like `https://www.familysearch.org/en/tree/person/details/{id}`.
- Store discovered FamilySearch IDs and traversal state so the extension can backtrack and avoid revisiting pages.
- Compare the collected FamilySearch snapshot against the normalized GEDCOM data.
- Show discrepancies in a review page, likely as side-by-side cards.

## Principles

- Keep everything local-first.
- Keep FamilySearch access read-only.
- Use the user's normal browser session for login, 2FA, and navigation.
- Do not use Playwright-driven browsing because FamilySearch blocked that approach.
- Use the extension app page as the user's control center.
- Use the extension background worker to coordinate tabs, traversal state, and content-script capture.
- Store raw capture data generously, then normalize/filter during comparison.
- Prefer bounded, user-started traversal with clear stop controls.

## Current Status

- [x] Proved normal Chrome/Safari sessions can access FamilySearch.
- [x] Confirmed Playwright/custom automation sessions are blocked by FamilySearch.
- [x] Created a Chrome WebExtension collector.
- [x] Captured visible data from a FamilySearch person page.
- [x] Extracted related FamilySearch IDs from visible page text/links.
- [x] Navigated to related person pages by direct FamilySearch person URL.
- [x] Added traversal queue, visited ID tracking, depth limit, page limit, delay, and stop/reset controls.
- [x] Added JSON export for collected FamilySearch snapshots.
- [x] Proved an extension-owned app page can serve as the control center while the extension still opens/navigates FamilySearch tabs and reads page data through content scripts.
- [x] Built the first Angular extension app page for local GEDCOM upload.
- [x] Configured hash routing for the Angular extension page.
- [x] Kept `manifest.json` at the extension root so Chrome can load the unpacked extension.
- [x] Added a GEDCOM parser and normalizer.
- [x] Converted the sample GEDCOM into normalized JSON with people, families, facts, and relationships.
- [x] Removed Playwright code and dependencies.

## Milestone 1: Extension App Shell

- [x] Prove an extension app page can coordinate with the background worker while FamilySearch remains open in normal browser tabs.
- [x] Replace the popup-first experience with a full Angular extension app page.
- [x] Open the Angular extension page from the extension action/icon.
- [x] Use hash routing for extension-safe Angular routes.
- [x] Build Angular output into `extension/familysearch-collector/app` while keeping Chrome's extension `manifest.json` at `extension/familysearch-collector/manifest.json`.
- [ ] Add app-page routes/sections for setup, GEDCOM import, start-person mapping, traversal status, and results.
- [ ] Move collector controls into the Angular app page.
- [ ] Keep the background service worker as the coordinator for FamilySearch tab navigation and capture.
- [ ] Keep content scripts responsible for reading FamilySearch page data.
- [ ] Preserve the popup only as a lightweight launcher if useful.

## Milestone 2: GEDCOM In Extension

- [ ] Let the extension upload/select a `.ged` file.
- [x] Let the extension upload/select a `.ged` file.
- [x] Parse GEDCOM inside the extension app page.
- [x] Store normalized GEDCOM JSON in extension local storage.
- [x] Show basic GEDCOM import summary: people count, family count, source/version, import time.
- [ ] Add clear/re-import GEDCOM controls.
- [x] Add clear/re-import GEDCOM controls.
- [x] Handle parse errors with useful messages.

## Milestone 3: Start-Person Mapping

- [ ] Capture current FamilySearch person ID and display name.
- [ ] Let the user choose the corresponding GEDCOM person.
- [ ] Add simple GEDCOM person search by name/date.
- [ ] Store FamilySearch ID to GEDCOM person ID mappings.
- [ ] Show current mapping status before comparison starts.
- [ ] Allow mapping corrections.

## Milestone 4: GEDCOM-Guided Traversal

- [ ] Use the mapped GEDCOM person as the traversal root.
- [ ] Decide expected branches from the GEDCOM graph instead of crawling everything visible.
- [ ] For each FamilySearch page, extract related person IDs by relationship context.
- [ ] Match extracted FamilySearch relatives to expected GEDCOM relatives.
- [ ] Queue only branches that the GEDCOM says should be checked.
- [ ] Store traversal state: current queue, visited FamilySearch IDs, mapped GEDCOM IDs, parent/child path, and relationship reason.
- [ ] Avoid revisiting already captured FamilySearch IDs.
- [ ] Continue traversal until all expected GEDCOM-covered branches are captured or marked missing/unmatched.
- [ ] Add resume support after popup/browser interruption.

## Milestone 5: Normalization

- [ ] Normalize FamilySearch raw snapshot records into a comparison-friendly person model.
- [ ] Normalize names into comparable given/surname/full-name forms.
- [ ] Normalize dates while preserving raw text.
- [ ] Normalize places while preserving raw text.
- [ ] Normalize core events: birth, christening, death, burial, residence, marriage, divorce, census, and other GEDCOM-supported facts.
- [ ] Normalize relationships: parents, spouses, children, siblings.
- [ ] Preserve raw source snippets for debugging comparison results.

## Milestone 6: Comparison Engine

- [ ] Compare current/root person first.
- [ ] Compare names.
- [ ] Compare birth facts: date and place.
- [ ] Compare christening facts: date and place.
- [ ] Compare death facts: date and place.
- [ ] Compare burial facts: date and place.
- [ ] Compare residence and other event facts.
- [ ] Compare parents.
- [ ] Compare spouses.
- [ ] Compare children.
- [ ] Compare siblings if useful, likely derived from parent families.
- [ ] Classify discrepancies: missing in FamilySearch, missing in GEDCOM, conflicting value, possible match, extra/unexpected person.
- [ ] Assign confidence/severity so the review UI can sort important differences first.

## Milestone 7: Results UI

- [ ] Add comparison results page inside the extension.
- [ ] Show discrepancy cards by person.
- [ ] Include FamilySearch ID and GEDCOM ID on each card.
- [ ] Show side-by-side FamilySearch vs GEDCOM values.
- [ ] Group by discrepancy type: facts, relationships, names, dates, places.
- [ ] Add filters: all, high confidence, relationship issues, fact issues, missing data.
- [ ] Add export results JSON.
- [ ] Later: add report export for sharing/review outside the extension.

## Milestone 8: Hardening

- [ ] Test with small GEDCOMs.
- [ ] Test with larger GEDCOMs.
- [ ] Test with private/living people behavior. (This should work for the signed in user's living relatives)
- [ ] Test with pages where relationships are hidden, collapsed, or lazy-loaded.
- [ ] Add robust handling for FamilySearch layout changes.
- [ ] Add manual retry/skip controls during traversal.
- [ ] Add rate/delay safeguards.
- [ ] Document extension install/update workflow.

## Open Design Questions

- [ ] How much fuzzy matching should be allowed before asking the user to confirm a person mapping?
- [ ] Should sibling comparison be explicit, or derived only through parent/child relationships?
- [ ] What is the minimum discrepancy card format that is useful enough for real review?
- [ ] Should traversal stop immediately on an unmatched expected relative, or continue and report it as a missing/mapping issue?
