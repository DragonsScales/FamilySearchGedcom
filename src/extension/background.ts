import { getErrorMessage, isRecord } from './helpers';

interface ChromeError {
  message?: string;
}

interface ChromeTab {
  id?: number;
  url?: string;
}

interface ChromeAlarm {
  name: string;
}

interface TabsQueryInfo {
  active?: boolean;
  currentWindow?: boolean;
}

interface TabsUpdateProperties {
  url?: string;
}

interface TabsCreateProperties {
  url: string;
}

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
    onUpdated: {
      addListener(callback: (tabId: number, changeInfo: { status?: string }, tab: ChromeTab) => void): void;
    };
  };
}

interface CollectorOptions {
  maxPages: number;
  maxDepth: number;
  delayMs: number;
  allowedIds: string[];
}

interface CollectorOptionsInput {
  maxPages?: unknown;
  maxDepth?: unknown;
  delayMs?: unknown;
  delaySeconds?: unknown;
  allowedIds?: unknown;
}

interface QueueItem {
  personId: string;
  name: string;
  relationshipHint: string;
  fromPersonId: string | null;
  depth: number;
  url: string;
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
  relationships?: CapturedRelationship[];
  traversal?: TraversalMetadata;
  [key: string]: unknown;
}

interface TraversalMetadata {
  source: string;
  depth: number;
  fromPersonId: string | null;
  relationshipHint: string | null;
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
  payload?: CollectorOptionsInput;
}

declare const chrome: ChromeApi;

const STORAGE_KEY = 'familySearchGedcomCollectorState';
const FAMILYSEARCH_PERSON_URL = 'https://www.familysearch.org/en/tree/person/details/';
const EXTENSION_APP_URL = 'index.html#/gedcom';
const ALARM_CAPTURE_PAGE = 'familysearchCollector.capturePage';
const ALARM_NEXT_NAVIGATION = 'familysearchCollector.nextNavigation';
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 60000;

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
      maxDepth: 3,
      delayMs: 6000,
      allowedIds: []
    },
    lastEvent: 'Idle',
    updatedAt: new Date().toISOString()
  };
}

function normalizeOptions(options: CollectorOptionsInput = {}): CollectorOptions {
  const maxPages = clampInteger(options.maxPages, 1, 500, 25);
  const maxDepth = clampInteger(options.maxDepth, 0, 20, 2);
  const delayMs = clampInteger(options.delayMs, MIN_DELAY_MS, MAX_DELAY_MS, 6000);
  const allowedIds = Array.isArray(options.allowedIds)
    ? [...new Set(options.allowedIds.map(normalizePersonId).filter(Boolean))]
    : [];

  return { maxPages, maxDepth, delayMs, allowedIds };
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizePersonId(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9-]+$/.test(normalized) ? normalized : '';
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
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  const [tab] = tabs;
  if (!tab?.id) throw new Error('No active browser tab found.');
  if (!tab.url?.startsWith('https://www.familysearch.org/')) {
    throw new Error('Open a FamilySearch page before using the collector.');
  }
  return { id: tab.id, url: tab.url };
}

async function captureActiveTab(): Promise<StateSummary> {
  const tab = await getActiveTab();
  const state = await captureAndStore(tab.id, { source: 'manual' });
  return summarizeState(state);
}

async function startTraversal(payload: CollectorOptionsInput = {}): Promise<StateSummary> {
  const tab = await getActiveTab();
  const existing = await loadState();
  const payloadDelaySeconds = Number(payload.delaySeconds);
  const payloadDelayMs = Number(payload.delayMs);
  const options = normalizeOptions({
    ...existing.options,
    ...payload,
    delayMs: (Number.isFinite(payloadDelaySeconds) && payloadDelaySeconds > 0)
      ? payloadDelaySeconds * 1000
      : Number.isFinite(payloadDelayMs) && payloadDelayMs > 0
        ? payloadDelayMs
        : existing.options.delayMs
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
    lastEvent: 'Traversal started from the active tab.'
  });

  const captured = await captureAndStore(tab.id, { source: 'traversal-start' });
  scheduleNextNavigation(captured.options.delayMs);
  return summarizeState(captured);
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

async function captureAndStore(tabId: number, metadata: Partial<Pick<TraversalMetadata, 'source'>> = {}): Promise<CollectorState> {
  const response = await sendCaptureMessage(tabId);
  if (!response.ok || !response.capture) {
    throw new Error(response.error ?? 'The active page could not be captured.');
  }

  const capture = response.capture;
  const state = await loadState();
  const personId = capture.person?.familySearchId ?? null;
  const activeDepth = state.activeItem?.depth ?? 0;
  const record: CaptureRecord = {
    ...capture,
    traversal: {
      source: metadata.source ?? 'manual',
      depth: activeDepth,
      fromPersonId: state.activeItem?.fromPersonId ?? null,
      relationshipHint: state.activeItem?.relationshipHint ?? null
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
    nextState = enqueueRelationshipLinks(nextState, record, activeDepth);
    if (nextState.records.length >= nextState.options.maxPages) {
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
  if (!personId) return [...records, record];

  return [
    ...records.filter((existing) => existing.person?.familySearchId !== personId),
    record
  ];
}

function enqueueRelationshipLinks(state: CollectorState, record: CaptureRecord, currentDepth: number): CollectorState {
  const currentPersonId = record.person?.familySearchId;
  const nextDepth = currentDepth + 1;
  if (nextDepth > state.options.maxDepth) return state;

  const allowed = new Set(state.options.allowedIds);
  const hasAllowedList = allowed.size > 0;
  const seen = new Set([
    ...state.visitedPersonIds,
    ...state.queue.map((item) => item.personId)
  ]);
  const queue = [...state.queue];

  for (const relationship of record.relationships ?? []) {
    const personId = normalizePersonId(relationship.personId);
    if (!personId || personId === currentPersonId || seen.has(personId)) continue;
    if (hasAllowedList && !allowed.has(personId)) continue;

    queue.push({
      personId,
      name: relationship.name ?? '',
      relationshipHint: relationship.relationshipHint ?? '',
      fromPersonId: currentPersonId ?? null,
      depth: nextDepth,
      url: `${FAMILYSEARCH_PERSON_URL}${personId}`
    });
    seen.add(personId);
  }

  return {
    ...state,
    queue,
    lastEvent: `Captured ${currentPersonId ?? 'page'} and queued ${queue.length} total person page(s).`
  };
}

function scheduleNextNavigation(delayMs: number): void {
  scheduleTraversalAlarm(ALARM_NEXT_NAVIGATION, delayMs);
}

async function navigateNextQueued(): Promise<CollectorState> {
  const state = await loadState();
  if (!state.running) return state;

  if (state.records.length >= state.options.maxPages) {
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url?.startsWith('https://www.familysearch.org/')) return;

  loadState()
    .then((state) => {
      if (!state.running || state.activeTabId !== tabId) return;
      scheduleTraversalCapture(state.options.delayMs);
    })
    .catch(() => {});
});

function scheduleTraversalCapture(delayMs: number): void {
  scheduleTraversalAlarm(ALARM_CAPTURE_PAGE, delayMs);
}

async function captureActiveTraversalPage(): Promise<CollectorState> {
  const state = await loadState();
  if (!state.running || !state.activeTabId) return state;

  const captured = await captureAndStore(state.activeTabId, { source: 'traversal' });
  if (captured.running) scheduleNextNavigation(captured.options.delayMs);
  return captured;
}

function scheduleTraversalAlarm(name: string, delayMs: number): void {
  const delay = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, delayMs));
  chrome.alarms.clear(name, () => {
    chrome.alarms.create(name, { when: Date.now() + delay });
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

async function sendCaptureMessage(tabId: number): Promise<CaptureResponse> {
  try {
    return await tabsSendMessage(tabId, { type: 'FS_CAPTURE_PAGE' });
  } catch (error) {
    if (!getErrorMessage(error).includes('Receiving end does not exist')) throw error;
    await injectContentScript(tabId);
    return tabsSendMessage(tabId, { type: 'FS_CAPTURE_PAGE' });
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
    typeof value['name'] === 'string' &&
    typeof value['relationshipHint'] === 'string' &&
    (typeof value['fromPersonId'] === 'string' || value['fromPersonId'] === null) &&
    typeof value['depth'] === 'number' &&
    typeof value['url'] === 'string';
}

function isCaptureRecord(value: unknown): value is CaptureRecord {
  return isRecord(value);
}

function isCaptureResponse(value: unknown): value is CaptureResponse {
  return isRecord(value) && typeof value['ok'] === 'boolean';
}

function toMessageEnvelope(message: unknown): MessageEnvelope {
  return isRecord(message)
    ? {
        type: message['type'],
        payload: isRecord(message['payload']) ? message['payload'] : undefined
      }
    : {};
}
