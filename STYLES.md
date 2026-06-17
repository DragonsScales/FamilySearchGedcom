# Project Styles

This file captures project-specific code style and organization rules that should guide future changes.

## TypeScript Types

- Do not use explicit `any` unless there is no reasonable typed alternative.
- Prefer `unknown` at external boundaries, then narrow with type guards before use.
- Keep unavoidable `any` usage as small and local as possible, with a comment explaining why it is necessary.
- `npm run strict-types` scans active TypeScript source for explicit `any`; a necessary exception should be discussed before weakening that check.

## Interfaces

- Shared interfaces live under `src/Interfaces`.
- Prefer interfaces for object shapes that cross file, component, route, or service boundaries.
- Keep component-private event or helper shapes in the component only when they are not reused elsewhere.
- Use source-specific interface files rather than large mixed barrels when a type belongs to a clear domain, such as GEDCOM, storage, or person cards.

## Angular Boundaries

- Routed components should act as containers: load data, coordinate state, and pass typed inputs/outputs to child components.
- Presentational components should avoid direct storage and browser API access.
- Browser and Chrome extension APIs should be wrapped in injectable services before use by routed components.

## Extension Constraints

- Preserve hash routing for extension pages.
- Do not load remote scripts or styles.
- Do not automate writes back to FamilySearch.
- Keep Chrome runtime source in TypeScript under `src/extension`; generated runtime JavaScript remains in `public/`.
