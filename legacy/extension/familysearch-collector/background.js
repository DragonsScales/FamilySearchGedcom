const STORAGE_KEY = 'familySearchGedcomCollectorState';
const FAMILYSEARCH_PERSON_URL = 'https://www.familysearch.org/en/tree/person/details/';
const EXTENSION_APP_URL = 'app/index.html#/gedcom';
const ALARM_CAPTURE_PAGE = 'familysearchCollector.capturePage';
const ALARM_NEXT_NAVIGATION = 'familysearchCollector.nextNavigation';
const MIN_DELAY_MS = 3000;
const MAX_DELAY_MS = 60000;

function defaultState() {
  return {
    running: false,
    activeTabId: null,
    activeItem: null,
    queue: [],
    visitedPersonIds: [],
    records: [],
    options: {
      maxPages: 25,
      maxDepth: 2,
      delayMs: 6000,
      allowedIds: []
    },
    lastEvent: 'Idle',
    updatedAt: new Date().toISOString()
  };
}

function normalizeOptions(options = {}) {
  const maxPages = clampInteger(options.maxPages, 1, 500, 25);
  const maxDepth = clampInteger(options.maxDepth, 0, 20, 2);
  const delayMs = clampInteger(options.delayMs, MIN_DELAY_MS, MAX_DELAY_MS, 6000);
  const allowedIds = Array.isArray(options.allowedIds)
    ? [...new Set(options.allowedIds.map(normalizePersonId).filter(Boolean))]
    : [];

  return { maxPages, maxDepth, delayMs, allowedIds };
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizePersonId(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9-]+$/.test(normalized) ? normalized : '';
}

async function loadState() {
  const stored = await storageGet(STORAGE_KEY);
  const state = stored[STORAGE_KEY] ?? {};
  const fallback = defaultState();

  return {
    ...fallback,
    ...state,
    queue: Array.isArray(state.queue) ? state.queue : fallback.queue,
    visitedPersonIds: Array.isArray(state.visitedPersonIds) ? state.visitedPersonIds : fallback.visitedPersonIds,
    records: Array.isArray(state.records) ? state.records : fallback.records,
    options: normalizeOptions({ ...fallback.options, ...state.options })
  };
}

async function saveState(state) {
  const nextState = {
    ...state,
    options: normalizeOptions(state.options),
    updatedAt: new Date().toISOString()
  };

  await storageSet({ [STORAGE_KEY]: nextState });
  return nextState;
}

function summarizeState(state) {
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

async function getActiveTab() {
  const tabs = await tabsQuery({ active: true, currentWindow: true });
  const [tab] = tabs;
  if (!tab?.id) throw new Error('No active browser tab found.');
  if (!tab.url?.startsWith('https://www.familysearch.org/')) {
    throw new Error('Open a FamilySearch page before using the collector.');
  }
  return tab;
}

async function captureActiveTab() {
  const tab = await getActiveTab();
  const state = await captureAndStore(tab.id, { source: 'manual' });
  return summarizeState(state);
}

async function startTraversal(payload = {}) {
  const tab = await getActiveTab();
  const existing = await loadState();
  const options = normalizeOptions({
    ...existing.options,
    ...payload,
    delayMs: Number(payload.delaySeconds) * 1000 || payload.delayMs || existing.options.delayMs
  });

  const state = await saveState({
    ...existing,
    running: true,
    activeTabId: tab.id,
    activeItem: null,
    queue: [],
    visitedPersonIds: existing.records
      .map((record) => record.person?.familySearchId)
      .filter(Boolean),
    options,
    lastEvent: 'Traversal started from the active tab.'
  });

  const captured = await captureAndStore(tab.id, { source: 'traversal-start' });
  scheduleNextNavigation(captured.options.delayMs);
  return summarizeState(captured);
}

async function stopTraversal() {
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

async function resetCollector() {
  await clearTraversalAlarms();
  const reset = await saveState(defaultState());
  return summarizeState(reset);
}

async function captureAndStore(tabId, metadata = {}) {
  const response = await sendCaptureMessage(tabId);
  if (!response?.ok) {
    throw new Error(response?.error ?? 'The active page could not be captured.');
  }

  const capture = response.capture;
  const state = await loadState();
  const personId = capture.person?.familySearchId;
  const activeDepth = state.activeItem?.depth ?? 0;
  const record = {
    ...capture,
    traversal: {
      source: metadata.source ?? 'manual',
      depth: activeDepth,
      fromPersonId: state.activeItem?.fromPersonId ?? null,
      relationshipHint: state.activeItem?.relationshipHint ?? null
    }
  };

  let nextState = {
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

function upsertRecord(records, record) {
  const personId = record.person?.familySearchId;
  if (!personId) return [...records, record];

  return [
    ...records.filter((existing) => existing.person?.familySearchId !== personId),
    record
  ];
}

function enqueueRelationshipLinks(state, record, currentDepth) {
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

function scheduleNextNavigation(delayMs) {
  scheduleTraversalAlarm(ALARM_NEXT_NAVIGATION, delayMs);
}

async function navigateNextQueued() {
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

  await tabsUpdate(nextState.activeTabId, { url: nextItem.url });
  return nextState;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url?.startsWith('https://www.familysearch.org/')) return;

  loadState()
    .then((state) => {
      if (!state.running || state.activeTabId !== tabId) return;
      scheduleTraversalCapture(tabId, state.options.delayMs);
    })
    .catch(() => {});
});

function scheduleTraversalCapture(tabId, delayMs) {
  scheduleTraversalAlarm(ALARM_CAPTURE_PAGE, delayMs);
}

async function captureActiveTraversalPage() {
  const state = await loadState();
  if (!state.running || !state.activeTabId) return state;

  const captured = await captureAndStore(state.activeTabId, { source: 'traversal' });
  if (captured.running) scheduleNextNavigation(captured.options.delayMs);
  return captured;
}

function scheduleTraversalAlarm(name, delayMs) {
  const delay = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, delayMs));
  chrome.alarms.clear(name, () => {
    chrome.alarms.create(name, { when: Date.now() + delay });
  });
}

function clearTraversalAlarms() {
  return Promise.all([
    clearAlarm(ALARM_CAPTURE_PAGE),
    clearAlarm(ALARM_NEXT_NAVIGATION)
  ]);
}

function clearAlarm(name) {
  return new Promise((resolve) => chrome.alarms.clear(name, resolve));
}

chrome.action.onClicked.addListener(() => {
  openExtensionApp().catch(async (error) => {
    const state = await loadState();
    await saveState({
      ...state,
      lastEvent: `Could not open extension app: ${error.message}`
    });
  });
});

async function openExtensionApp() {
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

async function stopAfterTraversalError(error) {
  await clearTraversalAlarms();
  const state = await loadState();
  await saveState({
    ...state,
    running: false,
    activeItem: null,
    lastEvent: `Traversal stopped after error: ${error.message}`
  });
}

async function sendCaptureMessage(tabId) {
  try {
    return await tabsSendMessage(tabId, { type: 'FS_CAPTURE_PAGE' });
  } catch (error) {
    if (!String(error.message).includes('Receiving end does not exist')) throw error;
    await injectContentScript(tabId);
    return tabsSendMessage(tabId, { type: 'FS_CAPTURE_PAGE' });
  }
}

function injectContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js']
    }, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
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
      return startTraversal(message.payload);
    case 'STOP_TRAVERSAL':
      return stopTraversal();
    case 'RESET_COLLECTOR':
      return resetCollector();
    default:
      throw new Error(`Unknown message type: ${message?.type ?? 'missing'}`);
  }
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

function tabsQuery(queryInfo) {
  return new Promise((resolve) => chrome.tabs.query(queryInfo, resolve));
}

function tabsUpdate(tabId, updateProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

function tabsCreate(createProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(tab);
    });
  });
}

function tabsSendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}
