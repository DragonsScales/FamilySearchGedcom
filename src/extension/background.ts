import { getErrorMessage, isRecord } from './helpers';
import type {
  FamilySearchCapturedFact,
  FamilySearchCapturedRelationship,
  FamilySearchPageDebugLink,
  FamilySearchPageDebugSnapshot,
  FamilySearchRetrievedPerson
} from '../Interfaces/familysearch-person.interface';
import type {
  NormalizedGedcomDocument,
  NormalizedGedcomPerson
} from '../Interfaces/gedcom.interface';
import type {
  StoredGedcomImport,
  StoredStartPersonMapping
} from '../Interfaces/storage.interface';
import {
  buildFamilySearchPersonDetailsUrl,
  extractFamilySearchPersonIdFromUrl,
  normalizeFamilySearchPersonId
} from '../familysearch-person-url';
import {
  buildGedcomTraversalRoute
} from '../gedcom-guided-traversal';
import type {
  GedcomTraversalBranch,
  GedcomTraversalUnmatched
} from '../gedcom-guided-traversal';

interface ChromeError {
  message?: string;
}

interface ChromeTab {
  id?: number;
  status?: string;
  url?: string;
}

interface ChromeAlarm {
  name: string;
}

interface TabsQueryInfo {
  active?: boolean;
  currentWindow?: boolean;
  url?: string | string[];
}

interface TabsUpdateProperties {
  url?: string;
}

interface TabsCreateProperties {
  url: string;
  active?: boolean;
}

type TabUpdatedListener = (
  tabId: number,
  changeInfo: { status?: string },
  tab: ChromeTab
) => void;

interface ScriptInjection {
  target: {
    tabId: number;
  };
  files: string[];
}

interface ChromeApi {
  action: {
    onClicked: {
      addListener(callback: () => void): void;
    };
  };
  alarms: {
    clear(name: string, callback?: () => void): void;
    create(name: string, alarmInfo: { when: number }): void;
    onAlarm: {
      addListener(callback: (alarm: ChromeAlarm) => void): void;
    };
  };
  runtime: {
    lastError?: ChromeError;
    getURL(path: string): string;
    onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: unknown,
          sendResponse: (response: ExtensionMessageResponse) => void
        ) => boolean
      ): void;
    };
  };
  scripting: {
    executeScript(injection: ScriptInjection, callback?: () => void): void;
  };
  storage: {
    local: {
      get(keys: string | string[] | Record<string, unknown> | null, callback: (items: Record<string, unknown>) => void): void;
      set(items: Record<string, unknown>, callback?: () => void): void;
    };
  };
  tabs: {
    query(queryInfo: TabsQueryInfo, callback: (tabs: ChromeTab[]) => void): void;
    update(tabId: number, updateProperties: TabsUpdateProperties, callback?: (tab: ChromeTab) => void): void;
    create(createProperties: TabsCreateProperties, callback?: (tab: ChromeTab) => void): void;
    sendMessage(tabId: number, message: unknown, callback?: (response: unknown) => void): void;
    remove(tabId: number, callback?: () => void): void;
    onUpdated: {
      addListener(callback: TabUpdatedListener): void;
      removeListener(callback: TabUpdatedListener): void;
    };
  };
}

interface CollectorOptions {
  maxPages: number;
  maxPagesEnabled: boolean;
  allowedIds: string[];
}

interface CollectorOptionsInput {
  familySearchId?: unknown;
  personId?: unknown;
  accountAccessConsent?: unknown;
  maxPages?: unknown;
  maxPagesEnabled?: unknown;
  allowedIds?: unknown;
}

interface RetrievePersonInput {
  familySearchId?: unknown;
  personId?: unknown;
}

interface QueueItem {
  personId: string;
  gedcomPersonId: string;
  name: string;
  relationshipHint: string;
  fromPersonId: string | null;
  fromGedcomPersonId: string | null;
  depth: number;
  url: string;
  branch: GedcomTraversalBranch;
  matchNote?: string;
}

interface CapturedPerson {
  familySearchId?: string | null;
  displayName?: string;
}

interface CapturedRelationship {
  personId?: string;
  name?: string;
  relationshipHint?: string;
}

interface CaptureRecord {
  person?: CapturedPerson;
  capturedAt?: string;
  facts?: FamilySearchCapturedFact[];
  relationships?: CapturedRelationship[];
  raw?: unknown;
  title?: string;
  traversal?: TraversalMetadata;
  url?: string;
  [key: string]: unknown;
}

interface TraversalMetadata {
  source: string;
  depth: number;
  fromPersonId: string | null;
  gedcomPersonId?: string | null;
  fromGedcomPersonId?: string | null;
  relationshipHint: string | null;
  branch?: GedcomTraversalBranch;
  matchStatus?: 'matched' | 'missing' | 'ambiguous';
  matchNote?: string;
}

interface CaptureMetadata {
  source?: string;
  expectedFamilySearchId?: string;
  gedcomPersonId?: string | null;
  fromGedcomPersonId?: string | null;
  branch?: GedcomTraversalBranch;
  matchStatus?: 'matched' | 'missing' | 'ambiguous';
  matchNote?: string;
}

interface CollectorState {
  running: boolean;
  activeTabId: number | null;
  activeItem: QueueItem | null;
  queue: QueueItem[];
  visitedPersonIds: string[];
  records: CaptureRecord[];
  options: CollectorOptions;
  lastEvent: string;
  updatedAt: string;
}

interface StateSummary {
  running: boolean;
  activeTabId: number | null;
  activeItem: QueueItem | null;
  queueLength: number;
  visitedCount: number;
  recordCount: number;
  options: CollectorOptions;
  lastEvent: string;
  updatedAt: string;
}

interface CaptureResponse {
  ok: boolean;
  capture?: CaptureRecord;
  error?: string;
}

interface ExtensionMessageResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface MessageEnvelope {
  type?: unknown;
  payload?: Record<string, unknown>;
}

declare const chrome: ChromeApi;

const STORAGE_KEY = 'familySearchGedcomCollectorState';
const GEDCOM_IMPORT_KEY = 'gedcomImport';
const START_PERSON_MAPPING_KEY = 'familySearchGedcomStartPersonMapping';
const EXTENSION_APP_URL = 'index.html#/gedcom';
const ALARM_CAPTURE_PAGE = 'familysearchCollector.capturePage';
const ALARM_NEXT_NAVIGATION = 'familysearchCollector.nextNavigation';
const PERSON_RETRIEVAL_TIMEOUT_MS = 30000;

function defaultState(): CollectorState {
  return {
    running: false,
    activeTabId: null,
    activeItem: null,
    queue: [],
    visitedPersonIds: [],
    records: [],
    options: {
      maxPages: 25,
      maxPagesEnabled: false,
      allowedIds: []
    },
    lastEvent: 'Idle',
    updatedAt: new Date().toISOString()
  };
}

function normalizeOptions(options: CollectorOptionsInput = {}): CollectorOptions {
  const maxPages = clampInteger(options.maxPages, 1, 500, 25);
  const maxPagesEnabled = options.maxPagesEnabled === true;
  const allowedIds = Array.isArray(options.allowedIds)
    ? [...new Set(options.allowedIds.map(normalizePersonId).filter(Boolean))]
    : [];

  return { maxPages, maxPagesEnabled, allowedIds };
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizePersonId(value: unknown): string {
  return normalizeFamilySearchPersonId(value);
}

async function loadState(): Promise<CollectorState> {
  const stored = await storageGet(STORAGE_KEY);
  const state = isRecord(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : {};
  const fallback = defaultState();
  const options = isRecord(state['options']) ? state['options'] : {};

  return {
    ...fallback,
    ...state,
    running: typeof state['running'] === 'boolean' ? state['running'] : fallback.running,
    activeTabId: typeof state['activeTabId'] === 'number' ? state['activeTabId'] : fallback.activeTabId,
    activeItem: isQueueItem(state['activeItem']) ? state['activeItem'] : fallback.activeItem,
    queue: Array.isArray(state['queue']) ? state['queue'].filter(isQueueItem) : fallback.queue,
    visitedPersonIds: Array.isArray(state['visitedPersonIds'])
      ? state['visitedPersonIds'].filter((id): id is string => typeof id === 'string')
      : fallback.visitedPersonIds,
    records: Array.isArray(state['records'])
      ? state['records'].filter(isCaptureRecord)
      : fallback.records,
    options: normalizeOptions({ ...fallback.options, ...options }),
    lastEvent: typeof state['lastEvent'] === 'string' ? state['lastEvent'] : fallback.lastEvent,
    updatedAt: typeof state['updatedAt'] === 'string' ? state['updatedAt'] : fallback.updatedAt
  };
}

async function saveState(state: CollectorState): Promise<CollectorState> {
  const nextState = {
    ...state,
    options: normalizeOptions(state.options),
    updatedAt: new Date().toISOString()
  };

  await storageSet({ [STORAGE_KEY]: nextState });
  return nextState;
}

function summarizeState(state: CollectorState): StateSummary {
  return {
    running: state.running,
    activeTabId: state.activeTabId,
    activeItem: state.activeItem,
    queueLength: state.queue.length,
    visitedCount: state.visitedPersonIds.length,
    recordCount: state.records.length,
    options: state.options,
    lastEvent: state.lastEvent,
    updatedAt: state.updatedAt
  };
}

async function getActiveTab(): Promise<Required<Pick<ChromeTab, 'id' | 'url'>>> {
  const activeTabs = await tabsQuery({ active: true, currentWindow: true });
  const activeFamilySearchTab = activeTabs.find(isFamilySearchTab);
  if (activeFamilySearchTab?.id && activeFamilySearchTab.url) {
    return { id: activeFamilySearchTab.id, url: activeFamilySearchTab.url };
  }

  const currentWindowFamilySearchTabs = await tabsQuery({
    currentWindow: true,
    url: 'https://www.familysearch.org/*'
  });
  const [currentWindowFamilySearchTab] = currentWindowFamilySearchTabs.filter(isFamilySearchTab);
  if (currentWindowFamilySearchTab?.id && currentWindowFamilySearchTab.url) {
    return { id: currentWindowFamilySearchTab.id, url: currentWindowFamilySearchTab.url };
  }

  const familySearchTabs = await tabsQuery({ url: 'https://www.familysearch.org/*' });
  const [familySearchTab] = familySearchTabs.filter(isFamilySearchTab);
  if (familySearchTab?.id && familySearchTab.url) {
    return { id: familySearchTab.id, url: familySearchTab.url };
  }

  const mappedFamilySearchId = await loadMappedFamilySearchId();
  if (mappedFamilySearchId) return openTraversalStartTab(mappedFamilySearchId);

  throw new Error('Save a FamilySearch starting person in Mapping before using the collector.');
}

function isFamilySearchTab(tab: ChromeTab): boolean {
  return Boolean(tab.id && tab.url?.startsWith('https://www.familysearch.org/'));
}

async function captureActiveTab(): Promise<StateSummary> {
  const tab = await getActiveTab();
  const state = await captureAndStore(tab.id, { source: 'manual' });
  return summarizeState(state);
}

async function retrieveFamilySearchPerson(payload: RetrievePersonInput = {}): Promise<FamilySearchRetrievedPerson> {
  const familySearchId = normalizePersonId(payload.familySearchId ?? payload.personId);
  if (!familySearchId) {
    throw new Error('Enter a valid FamilySearch ID before retrieving a person.');
  }

  const url = buildFamilySearchPersonDetailsUrl(familySearchId);
  const tab = await tabsCreate({ url, active: false });
  if (!tab.id) throw new Error('Could not open the FamilySearch person page.');

  try {
    if (tab.status !== 'complete') {
      await waitForTabComplete(tab.id);
    }
    const response = await sendCaptureMessage(tab.id, familySearchId);
    if (!response.ok || !response.capture) {
      throw new Error(response.error ?? 'The FamilySearch person page could not be captured.');
    }

    console.info('[FSG retrieval] raw capture from newly opened FamilySearch tab', response.capture);
    return toRetrievedPerson(response.capture, familySearchId, url);
  } finally {
    await tabsRemove(tab.id).catch(() => undefined);
  }
}

function toRetrievedPerson(
  capture: CaptureRecord,
  requestedFamilySearchId: string,
  fallbackUrl: string
): FamilySearchRetrievedPerson {
  const capturedUrlFamilySearchId = normalizePersonId(extractFamilySearchPersonIdFromUrl(capture.url ?? ''));
  const capturedFamilySearchId = normalizePersonId(capture.person?.familySearchId) || capturedUrlFamilySearchId;
  if (!capturedFamilySearchId) {
    throw new Error('The retrieved page did not contain a FamilySearch person ID.');
  }

  if (capturedFamilySearchId && capturedFamilySearchId !== requestedFamilySearchId) {
    throw new Error(`Retrieved ${capturedFamilySearchId}, but ${requestedFamilySearchId} was requested.`);
  }

  const familySearchId = capturedFamilySearchId || requestedFamilySearchId;
  return {
    familySearchId,
    displayName: capture.person?.displayName || capture.title || familySearchId,
    url: capture.url ?? fallbackUrl,
    title: capture.title ?? '',
    capturedAt: capture.capturedAt ?? new Date().toISOString(),
    facts: capture.facts ?? [],
    relationships: normalizeCapturedRelationships(capture.relationships ?? []),
    debugSnapshot: normalizeDebugSnapshot(capture.raw)
  };
}

async function startTraversal(payload: CollectorOptionsInput = {}): Promise<StateSummary> {
  if (payload.accountAccessConsent !== true) {
    throw new Error('Confirm that the extension can use your logged-in FamilySearch session before starting traversal.');
  }

  const { gedcomImport, mapping } = await loadGedcomTraversalContext();
  const rootGedcomPerson = findGedcomPerson(gedcomImport.document, mapping.gedcomPersonId);
  if (!rootGedcomPerson) {
    throw new Error('The saved GEDCOM starting person is no longer present in the imported GEDCOM file.');
  }

  const rootFamilySearchId = normalizePersonId(payload.familySearchId ?? payload.personId) ||
    normalizePersonId(mapping.familySearchId);
  if (!rootFamilySearchId) {
    throw new Error('Save a FamilySearch starting person in Mapping before starting traversal.');
  }

  const tab = await openTraversalStartTab(rootFamilySearchId);
  const existing = await loadState();
  const options = normalizeOptions({
    ...existing.options,
    ...payload
  });

  const state = await saveState({
    ...existing,
    running: true,
    activeTabId: tab.id,
    activeItem: null,
    queue: [],
    visitedPersonIds: existing.records
      .map((record) => record.person?.familySearchId)
      .filter((id): id is string => Boolean(id)),
    options,
    lastEvent: `Traversal started from ${rootFamilySearchId} for GEDCOM ${getGedcomPersonName(rootGedcomPerson)}.`
  });

  const captured = await captureAndStore(tab.id, {
    source: 'traversal-start',
    expectedFamilySearchId: rootFamilySearchId,
    gedcomPersonId: mapping.gedcomPersonId,
    fromGedcomPersonId: null,
    branch: 'root',
    matchStatus: 'matched',
    matchNote: 'Starting person mapping.'
  });
  scheduleNextNavigation();
  return summarizeState(captured);
}

async function loadMappedFamilySearchId(): Promise<string> {
  const stored = await storageGet(START_PERSON_MAPPING_KEY);
  const mapping = isRecord(stored[START_PERSON_MAPPING_KEY]) ? stored[START_PERSON_MAPPING_KEY] : {};
  return normalizePersonId(mapping['familySearchId']);
}

async function loadGedcomTraversalContext(): Promise<{
  gedcomImport: StoredGedcomImport;
  mapping: StoredStartPersonMapping;
}> {
  const gedcomImport = await loadGedcomImport();
  const mapping = await loadStartPersonMapping();
  return { gedcomImport, mapping };
}

async function loadGedcomImport(): Promise<StoredGedcomImport> {
  const stored = await storageGet(GEDCOM_IMPORT_KEY);
  const value = stored[GEDCOM_IMPORT_KEY];
  if (isStoredGedcomImport(value)) return value;
  throw new Error('Upload a GEDCOM file before starting traversal.');
}

async function loadStartPersonMapping(): Promise<StoredStartPersonMapping> {
  const stored = await storageGet(START_PERSON_MAPPING_KEY);
  const value = stored[START_PERSON_MAPPING_KEY];
  if (isStoredStartPersonMapping(value) && normalizePersonId(value.familySearchId)) return value;
  throw new Error('Save a GEDCOM starting person and FamilySearch ID before starting traversal.');
}

async function openTraversalStartTab(familySearchId: string): Promise<Required<Pick<ChromeTab, 'id' | 'url'>>> {
  const url = buildFamilySearchPersonDetailsUrl(familySearchId);
  const tab = await tabsCreate({ url, active: false });
  if (!tab.id) throw new Error('Could not open the FamilySearch traversal start page.');

  if (tab.status !== 'complete') {
    await waitForTabComplete(tab.id);
  }

  return { id: tab.id, url };
}

async function stopTraversal(): Promise<StateSummary> {
  const state = await loadState();
  await clearTraversalAlarms();
  const stopped = await saveState({
    ...state,
    running: false,
    activeItem: null,
    lastEvent: 'Traversal stopped.'
  });
  return summarizeState(stopped);
}

async function resetCollector(): Promise<StateSummary> {
  await clearTraversalAlarms();
  const reset = await saveState(defaultState());
  return summarizeState(reset);
}

async function captureAndStore(
  tabId: number,
  metadata: CaptureMetadata = {}
): Promise<CollectorState> {
  const response = await sendCaptureMessage(tabId, metadata.expectedFamilySearchId);
  if (!response.ok || !response.capture) {
    throw new Error(response.error ?? 'The active page could not be captured.');
  }

  const capture = response.capture;
  const state = await loadState();
  const personId = capture.person?.familySearchId ?? null;
  const activeDepth = state.activeItem?.depth ?? 0;
  const gedcomPersonId = metadata.gedcomPersonId ?? state.activeItem?.gedcomPersonId ?? null;
  const fromGedcomPersonId = metadata.fromGedcomPersonId ?? state.activeItem?.fromGedcomPersonId ?? null;
  const record: CaptureRecord = {
    ...capture,
    traversal: {
      source: metadata.source ?? 'manual',
      depth: activeDepth,
      fromPersonId: state.activeItem?.fromPersonId ?? null,
      gedcomPersonId,
      fromGedcomPersonId,
      relationshipHint: state.activeItem?.relationshipHint ?? null,
      branch: metadata.branch ?? state.activeItem?.branch ?? 'root',
      matchStatus: metadata.matchStatus ?? 'matched',
      matchNote: metadata.matchNote ?? state.activeItem?.matchNote
    }
  };

  let nextState: CollectorState = {
    ...state,
    records: upsertRecord(state.records, record),
    lastEvent: personId
      ? `Captured ${personId}${record.person?.displayName ? ` (${record.person.displayName})` : ''}.`
      : 'Captured the active FamilySearch page.'
  };

  if (personId && !nextState.visitedPersonIds.includes(personId)) {
    nextState = {
      ...nextState,
      visitedPersonIds: [...nextState.visitedPersonIds, personId]
    };
  }

  if (nextState.running) {
    const gedcomImport = await loadGedcomImport();
    nextState = enqueueGedcomExpectedRelatives(nextState, record, activeDepth, gedcomImport.document);
    if (hasReachedMaxPages(nextState)) {
      nextState = {
        ...nextState,
        running: false,
        activeItem: null,
        lastEvent: `Reached the max page limit (${nextState.options.maxPages}).`
      };
    }
  }

  return saveState(nextState);
}

function upsertRecord(records: CaptureRecord[], record: CaptureRecord): CaptureRecord[] {
  const personId = record.person?.familySearchId;
  if (!personId) {
    const gedcomPersonId = record.traversal?.gedcomPersonId;
    if (!gedcomPersonId) return [...records, record];

    return [
      ...records.filter((existing) => existing.traversal?.gedcomPersonId !== gedcomPersonId),
      record
    ];
  }

  return [
    ...records.filter((existing) => existing.person?.familySearchId !== personId),
    record
  ];
}

function buildUnmatchedGedcomRecord(
  unmatched: GedcomTraversalUnmatched,
  fromRecord: CaptureRecord,
  depth: number
): CaptureRecord {
  const fromPersonId = fromRecord.person?.familySearchId ?? null;
  return {
    schemaVersion: 1,
    source: 'gedcom-guided-placeholder',
    capturedAt: new Date().toISOString(),
    url: '',
    title: '',
    person: {
      familySearchId: null,
      displayName: ''
    },
    facts: [],
    relationships: [],
    traversal: {
      source: 'gedcom-guided-placeholder',
      depth,
      fromPersonId,
      gedcomPersonId: unmatched.gedcomPersonId,
      fromGedcomPersonId: fromRecord.traversal?.gedcomPersonId ?? null,
      relationshipHint: unmatched.relationshipHint,
      branch: unmatched.branch,
      matchStatus: unmatched.status,
      matchNote: `${unmatched.name}: ${unmatched.matchNote}`
    }
  };
}

function enqueueGedcomExpectedRelatives(
  state: CollectorState,
  record: CaptureRecord,
  currentDepth: number,
  document: NormalizedGedcomDocument
): CollectorState {
  const currentPersonId = record.person?.familySearchId;
  const currentGedcomPersonId = record.traversal?.gedcomPersonId;
  if (!currentGedcomPersonId) return state;

  const nextDepth = currentDepth + 1;
  const allowed = new Set(state.options.allowedIds);
  const hasAllowedList = allowed.size > 0;
  const seenFamilySearchIds = new Set([
    ...state.visitedPersonIds,
    ...state.queue.map((item) => item.personId)
  ]);
  const seenGedcomPersonIds = new Set([
    ...state.records
      .map((existingRecord) => existingRecord.traversal?.gedcomPersonId)
      .filter((gedcomPersonId): gedcomPersonId is string => Boolean(gedcomPersonId)),
    ...state.queue.map((item) => item.gedcomPersonId)
  ]);
  const queue = [...state.queue];
  let records = state.records;
  let queuedCount = 0;
  let unmatchedCount = 0;
  const route = buildGedcomTraversalRoute({
    document,
    currentGedcomPersonId,
    currentBranch: record.traversal?.branch ?? 'root',
    relationships: normalizeCapturedRelationships(record.relationships ?? []),
    seenGedcomPersonIds: [...seenGedcomPersonIds],
    seenFamilySearchIds: [...seenFamilySearchIds]
  });

  for (const match of route.matches) {
    const personId = normalizePersonId(match.familySearchId);
    if (!personId || personId === currentPersonId || seenFamilySearchIds.has(personId)) continue;
    if (hasAllowedList && !allowed.has(personId)) continue;

    queue.push({
      personId,
      gedcomPersonId: match.gedcomPersonId,
      name: match.name,
      relationshipHint: match.relationshipHint,
      fromPersonId: currentPersonId ?? null,
      fromGedcomPersonId: currentGedcomPersonId,
      depth: nextDepth,
      url: buildFamilySearchPersonDetailsUrl(personId),
      branch: match.branch,
      matchNote: match.matchNote
    });
    queuedCount += 1;
    seenFamilySearchIds.add(personId);
  }

  for (const unmatched of route.unmatched) {
    records = upsertRecord(records, buildUnmatchedGedcomRecord(unmatched, record, nextDepth));
    unmatchedCount += 1;
  }

  return {
    ...state,
    records,
    queue,
    lastEvent: `Captured ${currentPersonId ?? 'page'} and queued ${queuedCount} GEDCOM-guided page(s); ${unmatchedCount} expected relative(s) need review.`
  };
}

function scheduleNextNavigation(): void {
  scheduleTraversalAlarm(ALARM_NEXT_NAVIGATION);
}

async function navigateNextQueued(): Promise<CollectorState> {
  const state = await loadState();
  if (!state.running) return state;

  if (hasReachedMaxPages(state)) {
    return saveState({
      ...state,
      running: false,
      activeItem: null,
      lastEvent: `Reached the max page limit (${state.options.maxPages}).`
    });
  }

  const [nextItem, ...remainingQueue] = state.queue;
  if (!nextItem) {
    return saveState({
      ...state,
      running: false,
      activeItem: null,
      lastEvent: 'Traversal complete. No queued person pages remain.'
    });
  }

  const nextState = await saveState({
    ...state,
    queue: remainingQueue,
    activeItem: nextItem,
    lastEvent: `Opening ${nextItem.personId}${nextItem.name ? ` (${nextItem.name})` : ''}.`
  });

  if (!nextState.activeTabId) throw new Error('Traversal has no active tab to navigate.');
  await tabsUpdate(nextState.activeTabId, { url: nextItem.url });
  return nextState;
}

function countCapturedFamilySearchRecords(records: CaptureRecord[]): number {
  return records.filter((record) => Boolean(record.person?.familySearchId)).length;
}

function hasReachedMaxPages(state: CollectorState): boolean {
  return state.options.maxPagesEnabled &&
    countCapturedFamilySearchRecords(state.records) >= state.options.maxPages;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url?.startsWith('https://www.familysearch.org/')) return;

  loadState()
    .then((state) => {
      if (!state.running || state.activeTabId !== tabId) return;
      scheduleTraversalCapture();
    })
    .catch(() => {});
});

function scheduleTraversalCapture(): void {
  scheduleTraversalAlarm(ALARM_CAPTURE_PAGE);
}

async function captureActiveTraversalPage(): Promise<CollectorState> {
  const state = await loadState();
  if (!state.running || !state.activeTabId) return state;

  const captured = await captureAndStore(state.activeTabId, {
    source: 'traversal',
    expectedFamilySearchId: state.activeItem?.personId,
    matchStatus: 'matched'
  });
  if (captured.running) scheduleNextNavigation();
  return captured;
}

function scheduleTraversalAlarm(name: string): void {
  chrome.alarms.clear(name, () => {
    chrome.alarms.create(name, { when: Date.now() });
  });
}

function clearTraversalAlarms(): Promise<void[]> {
  return Promise.all([
    clearAlarm(ALARM_CAPTURE_PAGE),
    clearAlarm(ALARM_NEXT_NAVIGATION)
  ]);
}

function clearAlarm(name: string): Promise<void> {
  return new Promise((resolve) => chrome.alarms.clear(name, resolve));
}

chrome.action.onClicked.addListener(() => {
  openExtensionApp().catch(async (error: unknown) => {
    const state = await loadState();
    await saveState({
      ...state,
      lastEvent: `Could not open extension app: ${getErrorMessage(error)}`
    });
  });
});

async function openExtensionApp(): Promise<void> {
  const url = chrome.runtime.getURL(EXTENSION_APP_URL);
  await tabsCreate({ url });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NEXT_NAVIGATION) {
    navigateNextQueued().catch(stopAfterTraversalError);
    return;
  }

  if (alarm.name === ALARM_CAPTURE_PAGE) {
    captureActiveTraversalPage().catch(stopAfterTraversalError);
  }
});

async function stopAfterTraversalError(error: unknown): Promise<void> {
  await clearTraversalAlarms();
  const state = await loadState();
  await saveState({
    ...state,
    running: false,
    activeItem: null,
    lastEvent: `Traversal stopped after error: ${getErrorMessage(error)}`
  });
}

async function sendCaptureMessage(tabId: number, expectedFamilySearchId = ''): Promise<CaptureResponse> {
  const message = {
    type: 'FS_CAPTURE_PAGE',
    expectedFamilySearchId
  };

  try {
    return await tabsSendMessage(tabId, message);
  } catch (error) {
    if (!getErrorMessage(error).includes('Receiving end does not exist')) throw error;
    await injectContentScript(tabId);
    return tabsSendMessage(tabId, message);
  }
}

function injectContentScript(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js']
    }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message ?? 'Could not inject the content script.'));
      else resolve();
    });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error: unknown) => sendResponse({ ok: false, error: getErrorMessage(error) }));
  return true;
});

async function handleMessage(message: unknown): Promise<unknown> {
  const envelope = toMessageEnvelope(message);
  switch (envelope.type) {
    case 'GET_STATE':
      return summarizeState(await loadState());
    case 'EXPORT_RECORDS': {
      const state = await loadState();
      return {
        exportedAt: new Date().toISOString(),
        schemaVersion: 1,
        source: 'familysearch-gedcom-collector-extension',
        records: state.records
      };
    }
    case 'CAPTURE_CURRENT':
      return captureActiveTab();
    case 'RETRIEVE_FAMILYSEARCH_PERSON':
      return retrieveFamilySearchPerson(envelope.payload);
    case 'START_TRAVERSAL':
      return startTraversal(envelope.payload);
    case 'STOP_TRAVERSAL':
      return stopTraversal();
    case 'RESET_COLLECTOR':
      return resetCollector();
    default:
      throw new Error(`Unknown message type: ${String(envelope.type ?? 'missing')}`);
  }
}

function storageGet(keys: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

function tabsQuery(queryInfo: TabsQueryInfo): Promise<ChromeTab[]> {
  return new Promise((resolve) => chrome.tabs.query(queryInfo, resolve));
}

function tabsUpdate(tabId: number, updateProperties: TabsUpdateProperties): Promise<ChromeTab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message ?? 'Could not update the FamilySearch tab.'));
      else resolve(tab);
    });
  });
}

function tabsCreate(createProperties: TabsCreateProperties): Promise<ChromeTab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message ?? 'Could not open the extension app tab.'));
      else resolve(tab);
    });
  });
}

function tabsRemove(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.remove(tabId, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message ?? 'Could not close the FamilySearch tab.'));
      else resolve();
    });
  });
}

function waitForTabComplete(tabId: number): Promise<ChromeTab> {
  return new Promise((resolve, reject) => {
    let listener: TabUpdatedListener = () => {};
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Timed out waiting for the FamilySearch person page to load.'));
    }, PERSON_RETRIEVAL_TIMEOUT_MS);

    listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function tabsSendMessage(tabId: number, message: unknown): Promise<CaptureResponse> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message ?? 'Could not send a message to the content script.'));
        return;
      }

      if (isCaptureResponse(response)) resolve(response);
      else reject(new Error('Content script returned an invalid capture response.'));
    });
  });
}

function isQueueItem(value: unknown): value is QueueItem {
  return isRecord(value) &&
    typeof value['personId'] === 'string' &&
    typeof value['gedcomPersonId'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['relationshipHint'] === 'string' &&
    (typeof value['fromPersonId'] === 'string' || value['fromPersonId'] === null) &&
    (typeof value['fromGedcomPersonId'] === 'string' || value['fromGedcomPersonId'] === null) &&
    typeof value['depth'] === 'number' &&
    typeof value['url'] === 'string' &&
    isGedcomTraversalBranch(value['branch']);
}

function isGedcomTraversalBranch(value: unknown): value is GedcomTraversalBranch {
  return value === 'root' || value === 'ancestor' || value === 'descendant';
}

function isCaptureRecord(value: unknown): value is CaptureRecord {
  return isRecord(value);
}

function isCaptureResponse(value: unknown): value is CaptureResponse {
  return isRecord(value) && typeof value['ok'] === 'boolean';
}

function isStoredGedcomImport(value: unknown): value is StoredGedcomImport {
  return isRecord(value) &&
    typeof value['fileName'] === 'string' &&
    typeof value['fileSize'] === 'number' &&
    typeof value['importedAt'] === 'string' &&
    isNormalizedGedcomDocument(value['document']);
}

function isStoredStartPersonMapping(value: unknown): value is StoredStartPersonMapping {
  return isRecord(value) &&
    typeof value['gedcomPersonId'] === 'string' &&
    typeof value['familySearchId'] === 'string' &&
    typeof value['updatedAt'] === 'string';
}

function isNormalizedGedcomDocument(value: unknown): value is NormalizedGedcomDocument {
  return isRecord(value) &&
    isRecord(value['metadata']) &&
    Array.isArray(value['people']) &&
    value['people'].every(isNormalizedGedcomPerson) &&
    Array.isArray(value['families']) &&
    value['families'].every(isNormalizedGedcomFamily);
}

function isNormalizedGedcomPerson(value: unknown): value is NormalizedGedcomPerson {
  return isRecord(value) &&
    typeof value['id'] === 'string' &&
    Array.isArray(value['names']) &&
    Array.isArray(value['facts']) &&
    Array.isArray(value['parentFamilyIds']) &&
    value['parentFamilyIds'].every((item) => typeof item === 'string') &&
    Array.isArray(value['spouseFamilyIds']) &&
    value['spouseFamilyIds'].every((item) => typeof item === 'string') &&
    isRecord(value['relationships']);
}

function isNormalizedGedcomFamily(value: unknown): boolean {
  return isRecord(value) &&
    typeof value['id'] === 'string' &&
    Array.isArray(value['childIds']) &&
    value['childIds'].every((item) => typeof item === 'string') &&
    Array.isArray(value['facts']);
}

function findGedcomPerson(
  document: NormalizedGedcomDocument,
  gedcomPersonId: string
): NormalizedGedcomPerson | undefined {
  return document.people.find((person) => person.id === gedcomPersonId);
}

function getGedcomPersonName(person: NormalizedGedcomPerson): string {
  const name = person.names[0];
  if (!name) return person.id;
  if (name.given || name.surname) return [name.given, name.surname].filter(Boolean).join(' ');
  return name.full || person.id;
}

function normalizeCapturedRelationships(relationships: CapturedRelationship[]): FamilySearchCapturedRelationship[] {
  return relationships
    .map((relationship) => {
      const personId = normalizePersonId(relationship.personId);
      if (!personId) return null;

      return {
        personId,
        name: relationship.name ?? '',
        relationshipHint: relationship.relationshipHint ?? '',
        url: buildFamilySearchPersonDetailsUrl(personId),
        context: isRecord(relationship) && typeof relationship['context'] === 'string'
          ? relationship['context']
          : ''
      };
    })
    .filter((relationship): relationship is FamilySearchCapturedRelationship => relationship !== null);
}

function normalizeDebugSnapshot(value: unknown): FamilySearchPageDebugSnapshot | undefined {
  if (!isRecord(value)) return undefined;

  const links = Array.isArray(value['familySearchPersonLinks'])
    ? value['familySearchPersonLinks'].filter(isFamilySearchPageDebugLink)
    : [];

  return {
    url: getString(value['url']),
    title: getString(value['title']),
    expectedFamilySearchId: getString(value['expectedFamilySearchId']),
    documentReadyState: getString(value['documentReadyState']),
    readinessReason: getString(value['readinessReason']),
    loadingSkeletonCount: getNumber(value['loadingSkeletonCount']),
    hasExpectedFamilySearchId: getBoolean(value['hasExpectedFamilySearchId']),
    bodyTextLength: getNumber(value['bodyTextLength']),
    mainTextLength: getNumber(value['mainTextLength']),
    headings: getStringArray(value['headings']),
    visibleTextSample: getStringArray(value['visibleTextSample']),
    mainTextSample: getString(value['mainTextSample']),
    bodyTextSample: getString(value['bodyTextSample']),
    mainHtmlSample: getString(value['mainHtmlSample']),
    familySearchPersonLinks: links
  };
}

function isFamilySearchPageDebugLink(value: unknown): value is FamilySearchPageDebugLink {
  return isRecord(value) &&
    typeof value['text'] === 'string' &&
    typeof value['href'] === 'string' &&
    (typeof value['personId'] === 'string' || value['personId'] === null) &&
    typeof value['ariaLabel'] === 'string' &&
    typeof value['role'] === 'string' &&
    typeof value['context'] === 'string';
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function getNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function getBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function toMessageEnvelope(message: unknown): MessageEnvelope {
  return isRecord(message)
    ? {
        type: message['type'],
        payload: isRecord(message['payload']) ? message['payload'] : undefined
      }
    : {};
}
