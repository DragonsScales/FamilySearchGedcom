# FamilySearch GEDCOM Collector Extension

This is a local, read-only WebExtension prototype for importing GEDCOM files and capturing visible FamilySearch person pages into JSON.

## Safety Model

- You log in and navigate with your normal browser.
- The extension never enters credentials, handles 2FA, solves challenges, edits FamilySearch, or submits forms.
- The extension icon opens the Angular app page at `app/index.html#/gedcom`.
- Traversal runs in the visible active tab and has page/depth/delay limits.
- Use the optional allowed-ID list when comparing against a GEDCOM-covered set of FamilySearch people.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer Mode.
3. Click Load unpacked.
4. Select `extension/familysearch-collector`.
5. Click the extension icon to open the Angular app page.
6. Upload a GEDCOM file from the GEDCOM Upload page.
7. Open a FamilySearch person details page when you are ready to capture or compare FamilySearch data.

## Safari

Safari supports WebExtensions through an Xcode conversion flow, but this repo starts with Chrome because it is simpler to test. Once the capture model is stable, convert this directory with Apple's Safari Web Extension tooling and adapt any compatibility gaps.

## Local Data

The Angular app page stores the imported GEDCOM summary and normalized GEDCOM JSON in extension-local storage.

The FamilySearch snapshot export contains:

- Person ID and display name.
- Extracted fact-like rows from visible text.
- Visible linked FamilySearch person IDs and relationship hints.
- A small raw text sample for parser debugging.

## Traversal Model

Traversal starts from the current FamilySearch person page. The extension captures that visible page, extracts related FamilySearch IDs, queues direct person URLs like `https://www.familysearch.org/en/tree/person/details/24W7-3C8`, and then opens those queued pages in the same active tab. Each visited page repeats the same capture-and-queue step until the max page/depth limits are reached.
