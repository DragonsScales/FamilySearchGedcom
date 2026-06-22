import { cleanText, isRecord } from './helpers';
import {
  buildFamilySearchPersonDetailsUrl,
  extractFamilySearchPersonIdFromUrl,
  normalizeFamilySearchPersonId
} from '../familysearch-person-url';
import {
  cleanFamilySearchPersonName,
  isFamilySearchPersonLifeDetail,
  looksLikeFamilySearchPersonName
} from '../familysearch-person-name';
import type {
  FamilySearchPageDebugLink,
  FamilySearchPageDebugSnapshot
} from '../Interfaces/familysearch-person.interface';

interface ChromeRuntime {
  onMessage: {
    addListener(
      callback: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: CaptureMessageResponse) => void
      ) => boolean
    ): void;
  };
}

interface CaptureMessageResponse {
  ok: boolean;
  capture?: FamilySearchPageCapture;
  error?: string;
}

interface CaptureMessage {
  type: 'FS_CAPTURE_PAGE';
  expectedFamilySearchId?: string;
}

interface NetworkActivitySnapshot {
  inFlight: number;
  lastActivityAt: number;
}

interface NetworkActivityTracker {
  getSnapshot(): NetworkActivitySnapshot;
  isIdle(quietWindowMs: number): boolean;
}

interface TrackedWindow extends Window {
  __familySearchNetworkActivityTracker__?: NetworkActivityTracker;
}

interface PageReadiness {
  ready: boolean;
  reason: string;
  expectedFamilySearchId: string;
  hasExpectedFamilySearchId: boolean;
  loadingSkeletonCount: number;
}

interface ParsedPersonBlock {
  personId: string;
  name: string;
  gender: string;
  lifeSpan: string;
  startIndex: number;
  endIndex: number;
}

interface FamilySearchPageCapture {
  schemaVersion: 1;
  source: 'familysearch-visible-page';
  capturedAt: string;
  url: string;
  title: string;
  person: {
    familySearchId: string | null;
    displayName: string;
  };
  facts: CapturedFact[];
  relationships: CapturedRelationship[];
  raw: FamilySearchPageDebugSnapshot;
}

interface CapturedFact {
  type: string;
  values: string[];
  rawText: string;
}

interface CapturedRelationship {
  personId: string;
  name: string;
  relationshipHint: string;
  url: string;
  context: string;
}

declare const chrome: {
  runtime: ChromeRuntime;
};

const FAMILYSEARCH_ID_PATTERN = /\b[A-Z0-9]{4}-[A-Z0-9]{3}\b/g;
const FACT_LABELS = [
  'Name',
  'Sex',
  'Birth',
  'Christening',
  'Death',
  'Burial',
  'Residence',
  'Marriage',
  'Divorce',
  'Census',
  'Immigration',
  'Emigration',
  'Military Service',
  'Naturalization',
  'Probate',
  'Occupation',
  'National Origin',
  'Custom Event'
];
const FACT_SECTION_STOPS = [
  'Other Information',
  'Alternate Names',
  'Events',
  'Facts',
  'Family Members',
  'Spouses and Children',
  'Parents and Siblings',
  'Other Relationships',
  'Brief Life History'
];
const PAGE_READY_TIMEOUT_MS = 60000;
const PAGE_QUIET_WINDOW_MS = 750;
const PAGE_READY_POLL_MS = 250;
const DEBUG_TEXT_SAMPLE_LIMIT = 12000;
const DEBUG_HTML_SAMPLE_LIMIT = 20000;
const DEBUG_LINK_LIMIT = 200;
const networkActivityTracker = installNetworkActivityTracker();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isCaptureMessage(message)) return false;

  void (async () => {
    try {
      const expectedFamilySearchId = normalizeFamilySearchPersonId(message.expectedFamilySearchId);
      await waitForFamilySearchPageReady(expectedFamilySearchId);
      sendResponse({ ok: true, capture: captureVisibleFamilySearchPage(expectedFamilySearchId) });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Could not capture this page.'
      });
    }
  })();

  return true;
});

function isCaptureMessage(message: unknown): message is CaptureMessage {
  return isRecord(message) && message['type'] === 'FS_CAPTURE_PAGE';
}

function captureVisibleFamilySearchPage(expectedFamilySearchId: string): FamilySearchPageCapture {
  const root = document.querySelector<HTMLElement>('main') ?? document.body;
  const lines = textLines(root.innerText);
  const familySearchId = extractPersonId(window.location.href);

  return {
    schemaVersion: 1,
    source: 'familysearch-visible-page',
    capturedAt: new Date().toISOString(),
    url: window.location.href,
    title: document.title,
    person: {
      familySearchId,
      displayName: extractDisplayName(root, lines)
    },
    facts: extractFacts(lines),
    relationships: extractRelationships(root, familySearchId, lines),
    raw: buildDebugSnapshot(root, lines, expectedFamilySearchId)
  };
}

async function waitForFamilySearchPageReady(expectedFamilySearchId: string): Promise<void> {
  const startedAt = Date.now();
  let readiness = inspectPageReadiness(expectedFamilySearchId);

  while (Date.now() - startedAt < PAGE_READY_TIMEOUT_MS) {
    readiness = inspectPageReadiness(expectedFamilySearchId);
    if (readiness.ready) return;

    await delay(PAGE_READY_POLL_MS);
  }

  throw new Error(`Timed out waiting for the FamilySearch person page to finish loading: ${readiness.reason}`);
}

function inspectPageReadiness(expectedFamilySearchId: string): PageReadiness {
  const root = document.querySelector<HTMLElement>('main') ?? document.body;
  const mainText = cleanText(root.innerText);
  const lines = textLines(root.innerText);
  const loadingSkeletonCount = countLoadingSkeletons(root);
  const activeFamilySearchId = extractPersonId(window.location.href);
  const hasExpectedFamilySearchId = expectedFamilySearchId
    ? activeFamilySearchId === expectedFamilySearchId
    : false;
  const hasPersonHeading = hasVisiblePersonHeading(root, lines);
  const capturedFactCount = extractFacts(lines).length;
  const capturedRelationshipCount = extractRelationshipBlocks(lines, extractPersonId(window.location.href)).length;
  const hasCaptureablePersonDetails = capturedFactCount > 0 || capturedRelationshipCount > 0;
  const hasPersonLinks = root.querySelector('a[href*="/tree/person/"]') !== null;
  const networkIsQuiet = networkActivityTracker.isIdle(PAGE_QUIET_WINDOW_MS);

  if (document.readyState !== 'complete') {
    return readiness(false, 'document is still loading', expectedFamilySearchId, hasExpectedFamilySearchId, loadingSkeletonCount);
  }

  if (mainText.length === 0) {
    return readiness(false, 'main content is empty', expectedFamilySearchId, hasExpectedFamilySearchId, loadingSkeletonCount);
  }

  if (expectedFamilySearchId && !hasExpectedFamilySearchId) {
    return readiness(false, `expected ID ${expectedFamilySearchId} is not the active person page yet`, expectedFamilySearchId, hasExpectedFamilySearchId, loadingSkeletonCount);
  }

  if (loadingSkeletonCount > 0) {
    return readiness(false, `still showing ${loadingSkeletonCount} loading skeleton element(s)`, expectedFamilySearchId, hasExpectedFamilySearchId, loadingSkeletonCount);
  }

  if (!hasCaptureablePersonDetails) {
    return readiness(false, 'person detail cards are still loading', expectedFamilySearchId, hasExpectedFamilySearchId, loadingSkeletonCount);
  }

  if (!networkIsQuiet && !hasPersonHeading) {
    return readiness(false, 'network activity is still settling', expectedFamilySearchId, hasExpectedFamilySearchId, loadingSkeletonCount);
  }

  return readiness(true, 'person content appears ready', expectedFamilySearchId, hasExpectedFamilySearchId, loadingSkeletonCount);
}

function readiness(
  ready: boolean,
  reason: string,
  expectedFamilySearchId: string,
  hasExpectedFamilySearchId: boolean,
  loadingSkeletonCount: number
): PageReadiness {
  return {
    ready,
    reason,
    expectedFamilySearchId,
    hasExpectedFamilySearchId,
    loadingSkeletonCount
  };
}

function extractPersonId(url: string): string | null {
  return extractFamilySearchPersonIdFromUrl(url);
}

function installNetworkActivityTracker(): NetworkActivityTracker {
  const trackedWindow = window as TrackedWindow;
  if (trackedWindow.__familySearchNetworkActivityTracker__) {
    return trackedWindow.__familySearchNetworkActivityTracker__;
  }

  let inFlight = 0;
  let lastActivityAt = Date.now();

  const markActivity = (): void => {
    lastActivityAt = Date.now();
  };

  const increment = (): void => {
    inFlight += 1;
    markActivity();
  };

  const decrement = (): void => {
    inFlight = Math.max(0, inFlight - 1);
    markActivity();
  };

  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch.bind(window);
    const wrappedFetch: typeof window.fetch = async (...args) => {
      increment();
      try {
        return await originalFetch(...args);
      } finally {
        decrement();
      }
    };

    window.fetch = wrappedFetch;
  }

  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.send = function (...args: Parameters<XMLHttpRequest['send']>): ReturnType<XMLHttpRequest['send']> {
    increment();
    const onLoadEnd = (): void => {
      this.removeEventListener('loadend', onLoadEnd);
      decrement();
    };

    this.addEventListener('loadend', onLoadEnd);

    try {
      return originalSend.apply(this, args);
    } catch (error) {
      this.removeEventListener('loadend', onLoadEnd);
      decrement();
      throw error;
    }
  };

  if (typeof PerformanceObserver === 'function') {
    try {
      const observer = new PerformanceObserver((list) => {
        if (list.getEntries().length > 0) markActivity();
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      // Ignore browsers that do not support resource timing observation here.
    }
  }

  const tracker: NetworkActivityTracker = {
    getSnapshot: () => ({ inFlight, lastActivityAt }),
    isIdle: (quietWindowMs: number) => inFlight === 0 && Date.now() - lastActivityAt >= quietWindowMs
  };

  trackedWindow.__familySearchNetworkActivityTracker__ = tracker;
  return tracker;
}

function extractDisplayName(root: HTMLElement, lines: string[]): string {
  const headerName = extractHeaderPersonName(lines);
  if (headerName) return headerName;

  const heading = root.querySelector<HTMLElement>('h1');
  const headingText = cleanText(heading?.innerText);
  const parsedHeading = cleanPersonName(headingText);
  if (parsedHeading && !/familysearch|person/i.test(parsedHeading) && !isShellHeading(parsedHeading)) {
    return parsedHeading;
  }

  const titleName = cleanTitleName(document.title);
  if (titleName && !/familysearch/i.test(titleName)) return titleName;

  return lines
    .map(cleanPersonName)
    .find((line) => looksLikePersonName(line) && !isShellHeading(line)) ?? '';
}

function hasVisiblePersonHeading(root: HTMLElement, lines: string[]): boolean {
  if (extractHeaderPersonName(lines)) return true;

  const heading = root.querySelector<HTMLElement>('h1');
  const headingText = cleanPersonName(cleanText(heading?.innerText));
  return Boolean(headingText && !/familysearch|person/i.test(headingText) && !isShellHeading(headingText));
}

function extractHeadings(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('h1, h2, h3, [role="heading"]')]
    .map((element) => cleanText(element.innerText))
    .filter(Boolean)
    .slice(0, 80);
}

function buildDebugSnapshot(
  root: HTMLElement,
  lines: string[],
  expectedFamilySearchId: string
): FamilySearchPageDebugSnapshot {
  const bodyText = document.body?.innerText ?? '';
  const mainText = root.innerText ?? '';
  const readiness = inspectPageReadiness(expectedFamilySearchId);

  return {
    url: window.location.href,
    title: document.title,
    expectedFamilySearchId,
    documentReadyState: document.readyState,
    readinessReason: readiness.reason,
    loadingSkeletonCount: readiness.loadingSkeletonCount,
    hasExpectedFamilySearchId: readiness.hasExpectedFamilySearchId,
    bodyTextLength: bodyText.length,
    mainTextLength: mainText.length,
    headings: extractHeadings(root),
    visibleTextSample: lines.slice(0, 180),
    mainTextSample: truncateForDebug(mainText, DEBUG_TEXT_SAMPLE_LIMIT),
    bodyTextSample: truncateForDebug(bodyText, DEBUG_TEXT_SAMPLE_LIMIT),
    mainHtmlSample: truncateForDebug(root.outerHTML, DEBUG_HTML_SAMPLE_LIMIT),
    familySearchPersonLinks: extractDebugLinks(root)
  };
}

function extractDebugLinks(root: HTMLElement): FamilySearchPageDebugLink[] {
  return [...root.querySelectorAll<HTMLAnchorElement>('a[href*="/tree/person/"]')]
    .slice(0, DEBUG_LINK_LIMIT)
    .map((anchor) => ({
      text: cleanText(anchor.innerText),
      href: anchor.href,
      personId: extractPersonId(anchor.href),
      ariaLabel: cleanText(anchor.getAttribute('aria-label')),
      role: cleanText(anchor.getAttribute('role')),
      context: nearestUsefulContext(anchor).slice(0, 500)
    }));
}

function truncateForDebug(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} character(s)]`;
}

function countLoadingSkeletons(root: HTMLElement): number {
  return root.querySelectorAll([
    '[data-testid*="loading-skeleton"]',
    '[class*="skeletonCss"]',
    '[class*="Skeleton"]',
    '[aria-busy="true"]'
  ].join(',')).length;
}

function isShellHeading(value: string): boolean {
  return /^(vitals|detail view|other information|alternate names|events|facts|family members|show all family members|spouses and children|parents and siblings|other relationships|brief life history|children|parents|siblings|spouses|add child|add spouse|add parent|add other relationship)$/i.test(value);
}

function extractFacts(lines: string[]): CapturedFact[] {
  const facts: CapturedFact[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^Family Members$/i.test(line)) break;

    const label = matchFactLabel(line);

    if (!label) continue;

    const rawValues = collectFactRawValues(lines, index);
    const values = toFactValues(label, rawValues);

    if (values.length === 0) continue;

    facts.push({
      type: label,
      values,
      rawText: [line, ...rawValues].join(' | ')
    });
  }

  return facts.slice(0, 120);
}

function extractRelationships(
  root: HTMLElement,
  currentPersonId: string | null,
  lines: string[]
): CapturedRelationship[] {
  const relationshipById = new Map<string, CapturedRelationship>();
  const anchors = [...root.querySelectorAll<HTMLAnchorElement>('a[href*="/tree/person/"]')];

  for (const anchor of anchors) {
    const personId = extractPersonId(anchor.href);
    if (!personId || personId === currentPersonId) continue;

    const name = cleanText(anchor.innerText || anchor.getAttribute('aria-label'));
    const context = nearestUsefulContext(anchor);
    upsertRelationship(relationshipById, personId, {
      personId,
      name,
      relationshipHint: inferRelationshipHint(context),
      url: buildFamilySearchPersonDetailsUrl(personId),
      context: context.slice(0, 500)
    });
  }

  for (const relationship of extractRelationshipsFromVisibleText(lines, currentPersonId)) {
    upsertRelationship(relationshipById, relationship.personId, relationship);
  }

  for (const relationship of extractRelationshipBlocks(lines, currentPersonId)) {
    relationshipById.set(relationship.personId, relationship);
  }

  return [...relationshipById.values()].slice(0, 200);
}

function extractRelationshipBlocks(
  lines: string[],
  currentPersonId: string | null
): CapturedRelationship[] {
  const relationships: CapturedRelationship[] = [];
  let section: 'spouses-and-children' | 'parents-and-siblings' | null = null;
  let relationshipHint: 'spouse' | 'child' | 'parent' | 'sibling' | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^Spouses and Children$/i.test(line)) {
      section = 'spouses-and-children';
      relationshipHint = 'spouse';
      continue;
    }

    if (/^Parents and Siblings$/i.test(line)) {
      section = 'parents-and-siblings';
      relationshipHint = 'parent';
      continue;
    }

    if (/^Other Relationships$/i.test(line) || /^Brief Life History$/i.test(line)) {
      section = null;
      relationshipHint = null;
      continue;
    }

    if (!section || !relationshipHint) continue;

    if (/^Children(?:\s+\(\d+\))?$/i.test(line)) {
      relationshipHint = section === 'spouses-and-children' ? 'child' : 'sibling';
      continue;
    }

    if (/^(No Marriage Events|Marriage|ADD CHILD|ADD SPOUSE|ADD CHILD WITH AN UNKNOWN MOTHER|ADD PARENT)$/i.test(line)) {
      continue;
    }

    const personBlock = parsePersonBlock(lines, index);
    if (!personBlock) continue;

    if (personBlock.personId !== currentPersonId) {
      relationships.push({
        personId: personBlock.personId,
        name: personBlock.name,
        relationshipHint: refineRelationshipHint(relationshipHint, personBlock.gender),
        url: buildFamilySearchPersonDetailsUrl(personBlock.personId),
        context: lines.slice(index, personBlock.endIndex + 1).join(' | ')
      });
    }

    index = personBlock.endIndex;
  }

  return relationships;
}

function extractRelationshipsFromVisibleText(
  lines: string[],
  currentPersonId: string | null
): CapturedRelationship[] {
  const relationships: CapturedRelationship[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const ids = extractFamilySearchIds(line).filter((personId) => personId !== currentPersonId);

    for (const personId of ids) {
      const contextLines = lines.slice(Math.max(0, index - 5), Math.min(lines.length, index + 6));
      const context = contextLines.join(' | ');
      if (!looksLikeRelationshipContext(context)) continue;

      relationships.push({
        personId,
        name: inferNameNearId(lines, index, personId),
        relationshipHint: inferRelationshipHint(context),
        url: buildFamilySearchPersonDetailsUrl(personId),
        context: context.slice(0, 500)
      });
    }
  }

  return relationships;
}

function upsertRelationship(
  relationshipById: Map<string, CapturedRelationship>,
  personId: string,
  relationship: CapturedRelationship
): void {
  const existing = relationshipById.get(personId);
  relationshipById.set(personId, {
    personId,
    name: chooseRelationshipName(existing?.name ?? '', relationship.name || ''),
    relationshipHint: chooseRelationshipHint(existing?.relationshipHint ?? '', relationship.relationshipHint || ''),
    url: relationship.url,
    context: chooseLongerText(existing?.context ?? '', relationship.context || '')
  });
}

function extractFamilySearchIds(value: string): string[] {
  return value.match(/\b[A-Z0-9]{4}-[A-Z0-9]{3}\b/g)?.map((id) => id.toUpperCase()) ?? [];
}

function matchFactLabel(line: string): string | null {
  const normalized = line.replace(/\s*•\s*\d+\s+Sources?.*$/i, '').trim();
  return FACT_LABELS.find((label) => (
    normalized.toLowerCase() === label.toLowerCase() ||
    normalized.toLowerCase().startsWith(`${label.toLowerCase()} `)
  )) ?? null;
}

function collectFactRawValues(lines: string[], startIndex: number): string[] {
  const values: string[] = [];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (matchFactLabel(line)) break;
    if (isFactSectionStop(line)) break;
    if (/^(ADD|ADD EVENT|ADD FACT|ADD ALTERNATE NAME)$/i.test(line)) break;
    if (/^(Last Changed:|Reason:|MORE$)/i.test(line)) break;
    if (/^[A-Z]$/.test(line)) break;

    values.push(line);
  }

  return values;
}

function toFactValues(label: string, rawValues: string[]): string[] {
  const cleanedValues = rawValues.filter((value) => !isFactNoise(value));
  if (cleanedValues.length === 0) return [];

  if (label === 'Name') return [`Value: ${cleanPersonName(cleanedValues[0]) || cleanedValues[0]}`];
  if (label === 'Sex') return [`Value: ${cleanedValues[0]}`];

  if (label === 'Custom Event') {
    return toCustomEventValues(cleanedValues);
  }

  if (isValueOnlyFactLabel(label)) return cleanedValues.map((value) => `Value: ${value}`);

  return toDatePlaceValues(cleanedValues);
}

function toCustomEventValues(values: string[]): string[] {
  const [eventType, ...eventValues] = values;
  if (!eventType) return [];

  return [
    `Type: ${eventType}`,
    ...toEventDetailValues(eventValues)
  ];
}

function toEventDetailValues(values: string[]): string[] {
  if (values.length === 0) return [];
  if (!looksLikeDateValue(values[0])) return values.map((value) => `Value: ${value}`);
  return toDatePlaceValues(values);
}

function toDatePlaceValues(values: string[]): string[] {
  const [date, place, ...extraValues] = values;
  return [
    date ? `Date: ${date}` : '',
    place ? `Place: ${place}` : '',
    ...extraValues.map((value) => `Value: ${value}`)
  ].filter(Boolean);
}

function isValueOnlyFactLabel(label: string): boolean {
  return /^(Occupation|National Origin)$/i.test(label);
}

function looksLikeDateValue(value: string): boolean {
  return /\b\d{3,4}\b/.test(value) || /^(living|deceased|unknown)$/i.test(value.trim());
}

function isFactNoise(value: string): boolean {
  return /^(Last Changed:|Reason:|MORE$|ADD$)/i.test(value) || /^[A-Z]$/.test(value);
}

function isFactSectionStop(line: string): boolean {
  return FACT_SECTION_STOPS.some((section) => section.toLowerCase() === line.toLowerCase());
}

function parsePersonBlock(lines: string[], startIndex: number): ParsedPersonBlock | null {
  const name = cleanPersonName(lines[startIndex]);
  if (!looksLikePersonName(name)) return null;

  let gender = '';
  let lifeSpan = '';
  let personId = '';
  let endIndex = startIndex;

  for (let offset = 1; offset <= 5; offset += 1) {
    const line = lines[startIndex + offset];
    if (!line) break;

    if (/^(Male|Female|Unknown)$/i.test(line)) {
      gender = line;
      endIndex = startIndex + offset;
      continue;
    }

    if (isPersonLifeDetail(line)) {
      lifeSpan = line;
      endIndex = startIndex + offset;
      continue;
    }

    if (line === '•') {
      endIndex = startIndex + offset;
      continue;
    }

    const [id] = extractFamilySearchIds(line);
    if (id) {
      personId = id;
      endIndex = startIndex + offset;
      break;
    }

    if (offset > 1) break;
  }

  if (!personId) return null;

  return {
    personId,
    name,
    gender,
    lifeSpan,
    startIndex,
    endIndex
  };
}

function refineRelationshipHint(relationshipHint: string, gender: string): string {
  const normalizedGender = gender.toLowerCase();
  if (relationshipHint === 'parent' && normalizedGender === 'male') return 'father';
  if (relationshipHint === 'parent' && normalizedGender === 'female') return 'mother';
  if (relationshipHint === 'child' && normalizedGender === 'male') return 'son';
  if (relationshipHint === 'child' && normalizedGender === 'female') return 'daughter';
  if (relationshipHint === 'spouse' && normalizedGender === 'male') return 'husband';
  if (relationshipHint === 'spouse' && normalizedGender === 'female') return 'wife';
  return relationshipHint;
}

function extractHeaderPersonName(lines: string[]): string {
  const [name, gender, lifespan, bullet, personId] = lines;
  if (
    looksLikePersonName(name ?? '') &&
    /^(Male|Female|Unknown)$/i.test(gender ?? '') &&
    isPersonLifeDetail(lifespan ?? '') &&
    bullet === '•' &&
    extractFamilySearchIds(personId ?? '').length > 0
  ) {
    return cleanPersonName(name);
  }

  return '';
}

function cleanPersonName(value: string): string {
  return cleanFamilySearchPersonName(value);
}

function cleanTitleName(value: string): string {
  return cleanText(value)
    .replace(/\s*\|\s*FamilySearch.*$/i, '')
    .replace(/\s*•\s*Person\s*•\s*Family Tree.*$/i, '')
    .replace(/\s*\([^)]*\)\s*$/i, '')
    .trim();
}

function looksLikeRelationshipContext(context: string): boolean {
  const lower = context.toLowerCase();
  return [
    'family members',
    'parents and siblings',
    'spouses and children',
    'parent',
    'mother',
    'father',
    'sibling',
    'spouse',
    'wife',
    'husband',
    'child',
    'children',
    'son',
    'daughter'
  ].some((term) => lower.includes(term));
}

function inferNameNearId(lines: string[], index: number, personId: string): string {
  const sameLineName = cleanText(lines[index].replace(personId, '').replace(/\b(deceased|living)\b/gi, ''));
  if (looksLikePersonName(sameLineName)) return sameLineName;

  for (let offset = 1; offset <= 3; offset += 1) {
    const previous = cleanText(lines[index - offset]);
    if (looksLikePersonName(previous)) return previous;
  }

  for (let offset = 1; offset <= 2; offset += 1) {
    const next = cleanText(lines[index + offset]);
    if (looksLikePersonName(next)) return next;
  }

  return '';
}

function looksLikePersonName(value: string): boolean {
  return looksLikeFamilySearchPersonName(value) && !isShellHeading(value);
}

function isPersonLifeDetail(value: string): boolean {
  return isFamilySearchPersonLifeDetail(value);
}

function chooseRelationshipName(existingName: string, nextName: string): string {
  if (!existingName) return nextName;
  if (!nextName) return existingName;
  if (!looksLikePersonName(existingName) && looksLikePersonName(nextName)) return nextName;
  if (nextName.length > existingName.length && looksLikePersonName(nextName)) return nextName;
  return existingName;
}

function chooseRelationshipHint(existingHint: string, nextHint: string): string {
  if (!existingHint) return nextHint;
  if (!nextHint) return existingHint;
  return relationshipHintSpecificity(nextHint) > relationshipHintSpecificity(existingHint)
    ? nextHint
    : existingHint;
}

function relationshipHintSpecificity(relationshipHint: string): number {
  if (!relationshipHint) return 0;
  if (['parents-and-siblings', 'spouses-and-children'].includes(relationshipHint)) return 1;
  if (['parent', 'spouse', 'child', 'sibling'].includes(relationshipHint)) return 2;
  return 3;
}

function chooseLongerText(existingText: string, nextText: string): string {
  return nextText.length > existingText.length ? nextText : existingText;
}

function nearestUsefulContext(element: HTMLElement): string {
  let node: HTMLElement | null = element;
  for (let depth = 0; depth < 6 && node; depth += 1) {
    const text = cleanText(node.innerText);
    if (text.length > 20 && text.length < 1200) return text;
    node = node.parentElement;
  }

  return cleanText(element.innerText);
}

function inferRelationshipHint(context: string): string {
  const lower = context.toLowerCase();
  if (lower.includes('parents and siblings')) return 'parents-and-siblings';
  if (lower.includes('spouses and children')) return 'spouses-and-children';
  if (lower.includes('father')) return 'father';
  if (lower.includes('mother')) return 'mother';
  if (lower.includes('wife')) return 'wife';
  if (lower.includes('husband')) return 'husband';
  if (lower.includes('son')) return 'son';
  if (lower.includes('daughter')) return 'daughter';
  if (lower.includes('parent')) return 'parent';
  if (lower.includes('spouse')) return 'spouse';
  if (lower.includes('child') || lower.includes('children')) return 'child';
  if (lower.includes('sibling')) return 'sibling';
  return '';
}

function uniqueTextLines(text: string): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const cleaned of textLines(text)) {
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    lines.push(cleaned);
  }

  return lines;
}

function textLines(text: string): string[] {
  const lines: string[] = [];

  for (const line of text.split('\n')) {
    const cleaned = cleanText(line);
    if (!cleaned || cleaned.length > 250) continue;
    lines.push(cleaned);
  }

  return lines;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
