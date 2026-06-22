"use strict";
(() => {
  // src/extension/helpers.ts
  function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function isRecord(value) {
    return Boolean(value) && typeof value === "object";
  }

  // src/familysearch-person-url.ts
  var FAMILYSEARCH_PERSON_DETAILS_BASE_URL = "https://www.familysearch.org/en/tree/person/details/";
  var FAMILYSEARCH_PERSON_ROUTE_PATTERN = /\/tree\/person\/(?:(?:details|about|timeline|sources|memories|ordinances|collaborate|vitals|non-vitals|family)\/)?([A-Z0-9]{4}-[A-Z0-9]{3})(?:[/?#]|$)/i;
  function buildFamilySearchPersonDetailsUrl(personId) {
    return `${FAMILYSEARCH_PERSON_DETAILS_BASE_URL}${normalizeFamilySearchPersonId(personId)}`;
  }
  function extractFamilySearchPersonIdFromUrl(url) {
    const match = String(url).match(FAMILYSEARCH_PERSON_ROUTE_PATTERN);
    return match?.[1] ? normalizeFamilySearchPersonId(match[1]) : null;
  }
  function normalizeFamilySearchPersonId(value) {
    const normalized = String(value ?? "").trim().toUpperCase();
    return /^[A-Z0-9-]+$/.test(normalized) ? normalized : "";
  }

  // src/gedcom-guided-traversal.ts
  function buildGedcomTraversalRoute(input) {
    const expectedRelatives = buildExpectedGedcomRelatives(
      input.document,
      input.currentGedcomPersonId,
      input.currentBranch
    );
    const seenGedcomIds = new Set(input.seenGedcomPersonIds);
    const seenFamilySearchIds = new Set(input.seenFamilySearchIds);
    const matchedPageFamilySearchIds = /* @__PURE__ */ new Set();
    const route = {
      matches: [],
      unmatched: []
    };
    for (const expected of expectedRelatives) {
      if (seenGedcomIds.has(expected.gedcomPersonId)) continue;
      const result = matchRelationship(expected, input.relationships, matchedPageFamilySearchIds);
      if (!result.relationship) {
        route.unmatched.push({
          status: result.status === "ambiguous" ? "ambiguous" : "missing",
          gedcomPersonId: expected.gedcomPersonId,
          name: expected.name,
          relationshipHint: expected.relationshipHint,
          branch: expected.branch,
          matchNote: result.note
        });
        seenGedcomIds.add(expected.gedcomPersonId);
        continue;
      }
      if (seenFamilySearchIds.has(result.relationship.personId)) {
        seenGedcomIds.add(expected.gedcomPersonId);
        continue;
      }
      matchedPageFamilySearchIds.add(result.relationship.personId);
      seenFamilySearchIds.add(result.relationship.personId);
      seenGedcomIds.add(expected.gedcomPersonId);
      route.matches.push({
        status: "matched",
        gedcomPersonId: expected.gedcomPersonId,
        familySearchId: result.relationship.personId,
        name: expected.name,
        relationshipHint: expected.relationshipHint,
        branch: expected.branch,
        matchNote: result.note
      });
    }
    return route;
  }
  function buildExpectedGedcomRelatives(document, currentGedcomPersonId, currentBranch) {
    const personById = new Map(document.people.map((person) => [person.id, person]));
    const familyById = new Map(document.families.map((family) => [family.id, family]));
    const currentPerson = personById.get(currentGedcomPersonId);
    if (!currentPerson) return [];
    const relatives = [];
    const shouldExpandParents = currentBranch !== "descendant";
    if (shouldExpandParents) {
      relatives.push(...buildParentRelatives(currentPerson, personById, familyById));
    }
    relatives.push(...buildSpouseRelatives(currentPerson, currentBranch, personById, familyById));
    relatives.push(...buildChildRelatives(currentPerson, personById, familyById));
    return dedupeExpectedRelatives(relatives);
  }
  function buildParentRelatives(person, personById, familyById) {
    const relatives = [];
    for (const familyId of person.parentFamilyIds) {
      const family = familyById.get(familyId);
      if (!family) continue;
      const husbandIds = getFamilyHusbandIds(family);
      const wifeIds = getFamilyWifeIds(family);
      const father = husbandIds[0] ? personById.get(husbandIds[0]) : void 0;
      const mother = wifeIds[0] ? personById.get(wifeIds[0]) : void 0;
      const sameSexParents = Boolean(
        husbandIds.length > 1 || wifeIds.length > 1 || father?.sex && mother?.sex && normalizeSex(father.sex) === normalizeSex(mother.sex)
      );
      for (const husbandId of husbandIds) {
        const expected = personById.get(husbandId);
        relatives.push(toExpectedRelative(
          husbandId,
          expected,
          "father",
          "ancestor",
          !sameSexParents && normalizeSex(expected?.sex) !== "F"
        ));
      }
      for (const wifeId of wifeIds) {
        const expected = personById.get(wifeId);
        relatives.push(toExpectedRelative(
          wifeId,
          expected,
          "mother",
          "ancestor",
          !sameSexParents && normalizeSex(expected?.sex) !== "M"
        ));
      }
    }
    return relatives;
  }
  function buildSpouseRelatives(person, currentBranch, personById, familyById) {
    const branch = currentBranch === "ancestor" ? "ancestor" : "descendant";
    const relatives = [];
    for (const familyId of person.spouseFamilyIds) {
      const family = familyById.get(familyId);
      if (!family) continue;
      for (const spouseId of getFamilySpouseIds(family)) {
        if (!spouseId || spouseId === person.id) continue;
        relatives.push(toExpectedRelative(
          spouseId,
          personById.get(spouseId),
          "spouse",
          branch,
          true
        ));
      }
    }
    return relatives;
  }
  function buildChildRelatives(person, personById, familyById) {
    const relatives = [];
    for (const familyId of person.spouseFamilyIds) {
      const family = familyById.get(familyId);
      if (!family) continue;
      for (const childId of family.childIds) {
        relatives.push(toExpectedRelative(
          childId,
          personById.get(childId),
          "child",
          "descendant",
          true
        ));
      }
    }
    return relatives;
  }
  function toExpectedRelative(gedcomPersonId, person, relationshipHint, branch, trustRelationshipHint) {
    return {
      gedcomPersonId,
      name: getPrimaryName(person) || gedcomPersonId,
      relationshipHint,
      branch,
      birthDate: getBirthDate(person),
      trustRelationshipHint
    };
  }
  function dedupeExpectedRelatives(relatives) {
    const seen = /* @__PURE__ */ new Set();
    const deduped = [];
    for (const relative of relatives) {
      if (seen.has(relative.gedcomPersonId)) continue;
      seen.add(relative.gedcomPersonId);
      deduped.push(relative);
    }
    return deduped;
  }
  function matchRelationship(expected, relationships, matchedPageFamilySearchIds) {
    const unusedRelationships = relationships.filter((relationship) => relationship.personId && !matchedPageFamilySearchIds.has(relationship.personId));
    const candidates = unusedRelationships.filter((relationship) => relationshipMatchesExpectedKind(expected, relationship));
    if (candidates.length === 0) {
      return {
        status: "missing",
        note: `No FamilySearch ${expected.relationshipHint} relationship with a usable ID was found.`
      };
    }
    if (candidates.length === 1) {
      return {
        relationship: candidates[0],
        status: "matched",
        note: `Matched the only visible FamilySearch ${expected.relationshipHint}.`
      };
    }
    const firstNameMatches = candidates.filter((relationship) => normalizeFirstName(relationship.name) === normalizeFirstName(expected.name));
    if (firstNameMatches.length === 1) {
      return {
        relationship: firstNameMatches[0],
        status: "matched",
        note: "Matched by first name."
      };
    }
    const datePool = firstNameMatches.length > 1 ? firstNameMatches : candidates;
    const birthDateMatches = datePool.filter((relationship) => birthDatesMatch(expected.birthDate, relationship.context));
    if (birthDateMatches.length === 1) {
      return {
        relationship: birthDateMatches[0],
        status: "matched",
        note: "Matched by birth date."
      };
    }
    if (firstNameMatches.length > 1 || birthDateMatches.length > 1) {
      return {
        status: "ambiguous",
        note: `Multiple FamilySearch ${expected.relationshipHint} matches were found.`
      };
    }
    return {
      status: "missing",
      note: `No FamilySearch ${expected.relationshipHint} matched by first name or birth date.`
    };
  }
  function relationshipMatchesExpectedKind(expected, relationship) {
    const hint = relationship.relationshipHint.toLowerCase();
    if (expected.relationshipHint === "father") {
      return expected.trustRelationshipHint ? hint.includes("father") : isParentHint(hint);
    }
    if (expected.relationshipHint === "mother") {
      return expected.trustRelationshipHint ? hint.includes("mother") : isParentHint(hint);
    }
    if (expected.relationshipHint === "spouse") {
      return hint.includes("spouse") || hint.includes("wife") || hint.includes("husband");
    }
    return hint.includes("child") || hint.includes("son") || hint.includes("daughter");
  }
  function isParentHint(hint) {
    return hint.includes("parent") || hint.includes("father") || hint.includes("mother");
  }
  function birthDatesMatch(gedcomBirthDate, relationshipContext) {
    const gedcomYear = extractYear(gedcomBirthDate);
    const relationshipYear = extractRelationshipBirthYear(relationshipContext);
    return Boolean(gedcomYear && relationshipYear && gedcomYear === relationshipYear);
  }
  function extractRelationshipBirthYear(context) {
    const lifeSpan = context.split("|").map((part) => part.trim()).find((part) => /\d{3,4}\s*(?:[\u2013-]|$)/.test(part));
    return extractYear(lifeSpan ?? context);
  }
  function extractYear(value) {
    return String(value ?? "").match(/\b\d{3,4}\b/)?.[0] ?? "";
  }
  function getPrimaryName(person) {
    const name = person?.names[0];
    if (!name) return "";
    if (name.given || name.surname) return [name.given, name.surname].filter(Boolean).join(" ").trim();
    return name.full;
  }
  function normalizeFirstName(value) {
    return String(value ?? "").trim().split(/\s+/)[0]?.replace(/[^A-Za-z]/g, "").toLowerCase() ?? "";
  }
  function getBirthDate(person) {
    return findFact(person, "BIRT")?.date ?? "";
  }
  function findFact(person, type) {
    return person?.facts.find((fact) => fact.type === type);
  }
  function normalizeSex(value) {
    const normalized = value?.toUpperCase();
    if (normalized === "M" || normalized === "F") return normalized;
    return "";
  }
  function getFamilySpouseIds(family) {
    return [
      ...getFamilyHusbandIds(family),
      ...getFamilyWifeIds(family)
    ];
  }
  function getFamilyHusbandIds(family) {
    return family.husbandIds ?? [family.husbandId].filter((id) => Boolean(id));
  }
  function getFamilyWifeIds(family) {
    return family.wifeIds ?? [family.wifeId].filter((id) => Boolean(id));
  }

  // src/extension/background.ts
  var STORAGE_KEY = "familySearchGedcomCollectorState";
  var GEDCOM_IMPORT_KEY = "gedcomImport";
  var START_PERSON_MAPPING_KEY = "familySearchGedcomStartPersonMapping";
  var EXTENSION_APP_URL = "index.html#/gedcom";
  var ALARM_CAPTURE_PAGE = "familysearchCollector.capturePage";
  var ALARM_NEXT_NAVIGATION = "familysearchCollector.nextNavigation";
  var PERSON_RETRIEVAL_TIMEOUT_MS = 3e4;
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
        maxPagesEnabled: false,
        allowedIds: []
      },
      lastEvent: "Idle",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function normalizeOptions(options = {}) {
    const maxPages = clampInteger(options.maxPages, 1, 500, 25);
    const maxPagesEnabled = options.maxPagesEnabled === true;
    const allowedIds = Array.isArray(options.allowedIds) ? [...new Set(options.allowedIds.map(normalizePersonId).filter(Boolean))] : [];
    return { maxPages, maxPagesEnabled, allowedIds };
  }
  function clampInteger(value, min, max, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }
  function normalizePersonId(value) {
    return normalizeFamilySearchPersonId(value);
  }
  async function loadState() {
    const stored = await storageGet(STORAGE_KEY);
    const state = isRecord(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : {};
    const fallback = defaultState();
    const options = isRecord(state["options"]) ? state["options"] : {};
    return {
      ...fallback,
      ...state,
      running: typeof state["running"] === "boolean" ? state["running"] : fallback.running,
      activeTabId: typeof state["activeTabId"] === "number" ? state["activeTabId"] : fallback.activeTabId,
      activeItem: isQueueItem(state["activeItem"]) ? state["activeItem"] : fallback.activeItem,
      queue: Array.isArray(state["queue"]) ? state["queue"].filter(isQueueItem) : fallback.queue,
      visitedPersonIds: Array.isArray(state["visitedPersonIds"]) ? state["visitedPersonIds"].filter((id) => typeof id === "string") : fallback.visitedPersonIds,
      records: Array.isArray(state["records"]) ? state["records"].filter(isCaptureRecord) : fallback.records,
      options: normalizeOptions({ ...fallback.options, ...options }),
      lastEvent: typeof state["lastEvent"] === "string" ? state["lastEvent"] : fallback.lastEvent,
      updatedAt: typeof state["updatedAt"] === "string" ? state["updatedAt"] : fallback.updatedAt
    };
  }
  async function saveState(state) {
    const nextState = {
      ...state,
      options: normalizeOptions(state.options),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
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
    const activeTabs = await tabsQuery({ active: true, currentWindow: true });
    const activeFamilySearchTab = activeTabs.find(isFamilySearchTab);
    if (activeFamilySearchTab?.id && activeFamilySearchTab.url) {
      return { id: activeFamilySearchTab.id, url: activeFamilySearchTab.url };
    }
    const currentWindowFamilySearchTabs = await tabsQuery({
      currentWindow: true,
      url: "https://www.familysearch.org/*"
    });
    const [currentWindowFamilySearchTab] = currentWindowFamilySearchTabs.filter(isFamilySearchTab);
    if (currentWindowFamilySearchTab?.id && currentWindowFamilySearchTab.url) {
      return { id: currentWindowFamilySearchTab.id, url: currentWindowFamilySearchTab.url };
    }
    const familySearchTabs = await tabsQuery({ url: "https://www.familysearch.org/*" });
    const [familySearchTab] = familySearchTabs.filter(isFamilySearchTab);
    if (familySearchTab?.id && familySearchTab.url) {
      return { id: familySearchTab.id, url: familySearchTab.url };
    }
    const mappedFamilySearchId = await loadMappedFamilySearchId();
    if (mappedFamilySearchId) return openTraversalStartTab(mappedFamilySearchId);
    throw new Error("Save a FamilySearch starting person in Mapping before using the collector.");
  }
  function isFamilySearchTab(tab) {
    return Boolean(tab.id && tab.url?.startsWith("https://www.familysearch.org/"));
  }
  async function captureActiveTab() {
    const tab = await getActiveTab();
    const state = await captureAndStore(tab.id, { source: "manual" });
    return summarizeState(state);
  }
  async function retrieveFamilySearchPerson(payload = {}) {
    const familySearchId = normalizePersonId(payload.familySearchId ?? payload.personId);
    if (!familySearchId) {
      throw new Error("Enter a valid FamilySearch ID before retrieving a person.");
    }
    const url = buildFamilySearchPersonDetailsUrl(familySearchId);
    const tab = await tabsCreate({ url, active: false });
    if (!tab.id) throw new Error("Could not open the FamilySearch person page.");
    try {
      if (tab.status !== "complete") {
        await waitForTabComplete(tab.id);
      }
      const response = await sendCaptureMessage(tab.id, familySearchId);
      if (!response.ok || !response.capture) {
        throw new Error(response.error ?? "The FamilySearch person page could not be captured.");
      }
      console.info("[FSG retrieval] raw capture from newly opened FamilySearch tab", response.capture);
      return toRetrievedPerson(response.capture, familySearchId, url);
    } finally {
      await tabsRemove(tab.id).catch(() => void 0);
    }
  }
  function toRetrievedPerson(capture, requestedFamilySearchId, fallbackUrl) {
    const capturedUrlFamilySearchId = normalizePersonId(extractFamilySearchPersonIdFromUrl(capture.url ?? ""));
    const capturedFamilySearchId = normalizePersonId(capture.person?.familySearchId) || capturedUrlFamilySearchId;
    if (!capturedFamilySearchId) {
      throw new Error("The retrieved page did not contain a FamilySearch person ID.");
    }
    if (capturedFamilySearchId && capturedFamilySearchId !== requestedFamilySearchId) {
      throw new Error(`Retrieved ${capturedFamilySearchId}, but ${requestedFamilySearchId} was requested.`);
    }
    const familySearchId = capturedFamilySearchId || requestedFamilySearchId;
    return {
      familySearchId,
      displayName: capture.person?.displayName || capture.title || familySearchId,
      url: capture.url ?? fallbackUrl,
      title: capture.title ?? "",
      capturedAt: capture.capturedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
      facts: capture.facts ?? [],
      relationships: normalizeCapturedRelationships(capture.relationships ?? []),
      debugSnapshot: normalizeDebugSnapshot(capture.raw)
    };
  }
  async function startTraversal(payload = {}) {
    if (payload.accountAccessConsent !== true) {
      throw new Error("Confirm that the extension can use your logged-in FamilySearch session before starting traversal.");
    }
    const { gedcomImport, mapping } = await loadGedcomTraversalContext();
    const rootGedcomPerson = findGedcomPerson(gedcomImport.document, mapping.gedcomPersonId);
    if (!rootGedcomPerson) {
      throw new Error("The saved GEDCOM starting person is no longer present in the imported GEDCOM file.");
    }
    const rootFamilySearchId = normalizePersonId(payload.familySearchId ?? payload.personId) || normalizePersonId(mapping.familySearchId);
    if (!rootFamilySearchId) {
      throw new Error("Save a FamilySearch starting person in Mapping before starting traversal.");
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
      visitedPersonIds: existing.records.map((record) => record.person?.familySearchId).filter((id) => Boolean(id)),
      options,
      lastEvent: `Traversal started from ${rootFamilySearchId} for GEDCOM ${getGedcomPersonName(rootGedcomPerson)}.`
    });
    const captured = await captureAndStore(tab.id, {
      source: "traversal-start",
      expectedFamilySearchId: rootFamilySearchId,
      gedcomPersonId: mapping.gedcomPersonId,
      fromGedcomPersonId: null,
      branch: "root",
      matchStatus: "matched",
      matchNote: "Starting person mapping."
    });
    scheduleNextNavigation();
    return summarizeState(captured);
  }
  async function loadMappedFamilySearchId() {
    const stored = await storageGet(START_PERSON_MAPPING_KEY);
    const mapping = isRecord(stored[START_PERSON_MAPPING_KEY]) ? stored[START_PERSON_MAPPING_KEY] : {};
    return normalizePersonId(mapping["familySearchId"]);
  }
  async function loadGedcomTraversalContext() {
    const gedcomImport = await loadGedcomImport();
    const mapping = await loadStartPersonMapping();
    return { gedcomImport, mapping };
  }
  async function loadGedcomImport() {
    const stored = await storageGet(GEDCOM_IMPORT_KEY);
    const value = stored[GEDCOM_IMPORT_KEY];
    if (isStoredGedcomImport(value)) return value;
    throw new Error("Upload a GEDCOM file before starting traversal.");
  }
  async function loadStartPersonMapping() {
    const stored = await storageGet(START_PERSON_MAPPING_KEY);
    const value = stored[START_PERSON_MAPPING_KEY];
    if (isStoredStartPersonMapping(value) && normalizePersonId(value.familySearchId)) return value;
    throw new Error("Save a GEDCOM starting person and FamilySearch ID before starting traversal.");
  }
  async function openTraversalStartTab(familySearchId) {
    const url = buildFamilySearchPersonDetailsUrl(familySearchId);
    const tab = await tabsCreate({ url, active: false });
    if (!tab.id) throw new Error("Could not open the FamilySearch traversal start page.");
    if (tab.status !== "complete") {
      await waitForTabComplete(tab.id);
    }
    return { id: tab.id, url };
  }
  async function stopTraversal() {
    const state = await loadState();
    await clearTraversalAlarms();
    const stopped = await saveState({
      ...state,
      running: false,
      activeItem: null,
      lastEvent: "Traversal stopped."
    });
    return summarizeState(stopped);
  }
  async function resetCollector() {
    await clearTraversalAlarms();
    const reset = await saveState(defaultState());
    return summarizeState(reset);
  }
  async function captureAndStore(tabId, metadata = {}) {
    const response = await sendCaptureMessage(tabId, metadata.expectedFamilySearchId);
    if (!response.ok || !response.capture) {
      throw new Error(response.error ?? "The active page could not be captured.");
    }
    const capture = response.capture;
    const state = await loadState();
    const personId = capture.person?.familySearchId ?? null;
    const activeDepth = state.activeItem?.depth ?? 0;
    const gedcomPersonId = metadata.gedcomPersonId ?? state.activeItem?.gedcomPersonId ?? null;
    const fromGedcomPersonId = metadata.fromGedcomPersonId ?? state.activeItem?.fromGedcomPersonId ?? null;
    const record = {
      ...capture,
      traversal: {
        source: metadata.source ?? "manual",
        depth: activeDepth,
        fromPersonId: state.activeItem?.fromPersonId ?? null,
        gedcomPersonId,
        fromGedcomPersonId,
        relationshipHint: state.activeItem?.relationshipHint ?? null,
        branch: metadata.branch ?? state.activeItem?.branch ?? "root",
        matchStatus: metadata.matchStatus ?? "matched",
        matchNote: metadata.matchNote ?? state.activeItem?.matchNote
      }
    };
    let nextState = {
      ...state,
      records: upsertRecord(state.records, record),
      lastEvent: personId ? `Captured ${personId}${record.person?.displayName ? ` (${record.person.displayName})` : ""}.` : "Captured the active FamilySearch page."
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
  function upsertRecord(records, record) {
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
  function buildUnmatchedGedcomRecord(unmatched, fromRecord, depth) {
    const fromPersonId = fromRecord.person?.familySearchId ?? null;
    return {
      schemaVersion: 1,
      source: "gedcom-guided-placeholder",
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      url: "",
      title: "",
      person: {
        familySearchId: null,
        displayName: ""
      },
      facts: [],
      relationships: [],
      traversal: {
        source: "gedcom-guided-placeholder",
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
  function enqueueGedcomExpectedRelatives(state, record, currentDepth, document) {
    const currentPersonId = record.person?.familySearchId;
    const currentGedcomPersonId = record.traversal?.gedcomPersonId;
    if (!currentGedcomPersonId) return state;
    const nextDepth = currentDepth + 1;
    const allowed = new Set(state.options.allowedIds);
    const hasAllowedList = allowed.size > 0;
    const seenFamilySearchIds = /* @__PURE__ */ new Set([
      ...state.visitedPersonIds,
      ...state.queue.map((item) => item.personId)
    ]);
    const seenGedcomPersonIds = /* @__PURE__ */ new Set([
      ...state.records.map((existingRecord) => existingRecord.traversal?.gedcomPersonId).filter((gedcomPersonId) => Boolean(gedcomPersonId)),
      ...state.queue.map((item) => item.gedcomPersonId)
    ]);
    const queue = [...state.queue];
    let records = state.records;
    let queuedCount = 0;
    let unmatchedCount = 0;
    const route = buildGedcomTraversalRoute({
      document,
      currentGedcomPersonId,
      currentBranch: record.traversal?.branch ?? "root",
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
      lastEvent: `Captured ${currentPersonId ?? "page"} and queued ${queuedCount} GEDCOM-guided page(s); ${unmatchedCount} expected relative(s) need review.`
    };
  }
  function scheduleNextNavigation() {
    scheduleTraversalAlarm(ALARM_NEXT_NAVIGATION);
  }
  async function navigateNextQueued() {
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
        lastEvent: "Traversal complete. No queued person pages remain."
      });
    }
    const nextState = await saveState({
      ...state,
      queue: remainingQueue,
      activeItem: nextItem,
      lastEvent: `Opening ${nextItem.personId}${nextItem.name ? ` (${nextItem.name})` : ""}.`
    });
    if (!nextState.activeTabId) throw new Error("Traversal has no active tab to navigate.");
    await tabsUpdate(nextState.activeTabId, { url: nextItem.url });
    return nextState;
  }
  function countCapturedFamilySearchRecords(records) {
    return records.filter((record) => Boolean(record.person?.familySearchId)).length;
  }
  function hasReachedMaxPages(state) {
    return state.options.maxPagesEnabled && countCapturedFamilySearchRecords(state.records) >= state.options.maxPages;
  }
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return;
    if (!tab.url?.startsWith("https://www.familysearch.org/")) return;
    loadState().then((state) => {
      if (!state.running || state.activeTabId !== tabId) return;
      scheduleTraversalCapture();
    }).catch(() => {
    });
  });
  function scheduleTraversalCapture() {
    scheduleTraversalAlarm(ALARM_CAPTURE_PAGE);
  }
  async function captureActiveTraversalPage() {
    const state = await loadState();
    if (!state.running || !state.activeTabId) return state;
    const captured = await captureAndStore(state.activeTabId, {
      source: "traversal",
      expectedFamilySearchId: state.activeItem?.personId,
      matchStatus: "matched"
    });
    if (captured.running) scheduleNextNavigation();
    return captured;
  }
  function scheduleTraversalAlarm(name) {
    chrome.alarms.clear(name, () => {
      chrome.alarms.create(name, { when: Date.now() });
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
        lastEvent: `Could not open extension app: ${getErrorMessage(error)}`
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
      lastEvent: `Traversal stopped after error: ${getErrorMessage(error)}`
    });
  }
  async function sendCaptureMessage(tabId, expectedFamilySearchId = "") {
    const message = {
      type: "FS_CAPTURE_PAGE",
      expectedFamilySearchId
    };
    try {
      return await tabsSendMessage(tabId, message);
    } catch (error) {
      if (!getErrorMessage(error).includes("Receiving end does not exist")) throw error;
      await injectContentScript(tabId);
      return tabsSendMessage(tabId, message);
    }
  }
  function injectContentScript(tabId) {
    return new Promise((resolve, reject) => {
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["content-script.js"]
      }, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message ?? "Could not inject the content script."));
        else resolve();
      });
    });
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message).then((result) => sendResponse({ ok: true, result })).catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  });
  async function handleMessage(message) {
    const envelope = toMessageEnvelope(message);
    switch (envelope.type) {
      case "GET_STATE":
        return summarizeState(await loadState());
      case "EXPORT_RECORDS": {
        const state = await loadState();
        return {
          exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
          schemaVersion: 1,
          source: "familysearch-gedcom-collector-extension",
          records: state.records
        };
      }
      case "CAPTURE_CURRENT":
        return captureActiveTab();
      case "RETRIEVE_FAMILYSEARCH_PERSON":
        return retrieveFamilySearchPerson(envelope.payload);
      case "START_TRAVERSAL":
        return startTraversal(envelope.payload);
      case "STOP_TRAVERSAL":
        return stopTraversal();
      case "RESET_COLLECTOR":
        return resetCollector();
      default:
        throw new Error(`Unknown message type: ${String(envelope.type ?? "missing")}`);
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
        if (error) reject(new Error(error.message ?? "Could not update the FamilySearch tab."));
        else resolve(tab);
      });
    });
  }
  function tabsCreate(createProperties) {
    return new Promise((resolve, reject) => {
      chrome.tabs.create(createProperties, (tab) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message ?? "Could not open the extension app tab."));
        else resolve(tab);
      });
    });
  }
  function tabsRemove(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.remove(tabId, () => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message ?? "Could not close the FamilySearch tab."));
        else resolve();
      });
    });
  }
  function waitForTabComplete(tabId) {
    return new Promise((resolve, reject) => {
      let listener = () => {
      };
      const timeoutId = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("Timed out waiting for the FamilySearch person page to load."));
      }, PERSON_RETRIEVAL_TIMEOUT_MS);
      listener = (updatedTabId, changeInfo, tab) => {
        if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
        clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(tab);
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
  function tabsSendMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message ?? "Could not send a message to the content script."));
          return;
        }
        if (isCaptureResponse(response)) resolve(response);
        else reject(new Error("Content script returned an invalid capture response."));
      });
    });
  }
  function isQueueItem(value) {
    return isRecord(value) && typeof value["personId"] === "string" && typeof value["gedcomPersonId"] === "string" && typeof value["name"] === "string" && typeof value["relationshipHint"] === "string" && (typeof value["fromPersonId"] === "string" || value["fromPersonId"] === null) && (typeof value["fromGedcomPersonId"] === "string" || value["fromGedcomPersonId"] === null) && typeof value["depth"] === "number" && typeof value["url"] === "string" && isGedcomTraversalBranch(value["branch"]);
  }
  function isGedcomTraversalBranch(value) {
    return value === "root" || value === "ancestor" || value === "descendant";
  }
  function isCaptureRecord(value) {
    return isRecord(value);
  }
  function isCaptureResponse(value) {
    return isRecord(value) && typeof value["ok"] === "boolean";
  }
  function isStoredGedcomImport(value) {
    return isRecord(value) && typeof value["fileName"] === "string" && typeof value["fileSize"] === "number" && typeof value["importedAt"] === "string" && isNormalizedGedcomDocument(value["document"]);
  }
  function isStoredStartPersonMapping(value) {
    return isRecord(value) && typeof value["gedcomPersonId"] === "string" && typeof value["familySearchId"] === "string" && typeof value["updatedAt"] === "string";
  }
  function isNormalizedGedcomDocument(value) {
    return isRecord(value) && isRecord(value["metadata"]) && Array.isArray(value["people"]) && value["people"].every(isNormalizedGedcomPerson) && Array.isArray(value["families"]) && value["families"].every(isNormalizedGedcomFamily);
  }
  function isNormalizedGedcomPerson(value) {
    return isRecord(value) && typeof value["id"] === "string" && Array.isArray(value["names"]) && Array.isArray(value["facts"]) && Array.isArray(value["parentFamilyIds"]) && value["parentFamilyIds"].every((item) => typeof item === "string") && Array.isArray(value["spouseFamilyIds"]) && value["spouseFamilyIds"].every((item) => typeof item === "string") && isRecord(value["relationships"]);
  }
  function isNormalizedGedcomFamily(value) {
    return isRecord(value) && typeof value["id"] === "string" && Array.isArray(value["childIds"]) && value["childIds"].every((item) => typeof item === "string") && Array.isArray(value["facts"]);
  }
  function findGedcomPerson(document, gedcomPersonId) {
    return document.people.find((person) => person.id === gedcomPersonId);
  }
  function getGedcomPersonName(person) {
    const name = person.names[0];
    if (!name) return person.id;
    if (name.given || name.surname) return [name.given, name.surname].filter(Boolean).join(" ");
    return name.full || person.id;
  }
  function normalizeCapturedRelationships(relationships) {
    return relationships.map((relationship) => {
      const personId = normalizePersonId(relationship.personId);
      if (!personId) return null;
      return {
        personId,
        name: relationship.name ?? "",
        relationshipHint: relationship.relationshipHint ?? "",
        url: buildFamilySearchPersonDetailsUrl(personId),
        context: isRecord(relationship) && typeof relationship["context"] === "string" ? relationship["context"] : ""
      };
    }).filter((relationship) => relationship !== null);
  }
  function normalizeDebugSnapshot(value) {
    if (!isRecord(value)) return void 0;
    const links = Array.isArray(value["familySearchPersonLinks"]) ? value["familySearchPersonLinks"].filter(isFamilySearchPageDebugLink) : [];
    return {
      url: getString(value["url"]),
      title: getString(value["title"]),
      expectedFamilySearchId: getString(value["expectedFamilySearchId"]),
      documentReadyState: getString(value["documentReadyState"]),
      readinessReason: getString(value["readinessReason"]),
      loadingSkeletonCount: getNumber(value["loadingSkeletonCount"]),
      hasExpectedFamilySearchId: getBoolean(value["hasExpectedFamilySearchId"]),
      bodyTextLength: getNumber(value["bodyTextLength"]),
      mainTextLength: getNumber(value["mainTextLength"]),
      headings: getStringArray(value["headings"]),
      visibleTextSample: getStringArray(value["visibleTextSample"]),
      mainTextSample: getString(value["mainTextSample"]),
      bodyTextSample: getString(value["bodyTextSample"]),
      mainHtmlSample: getString(value["mainHtmlSample"]),
      familySearchPersonLinks: links
    };
  }
  function isFamilySearchPageDebugLink(value) {
    return isRecord(value) && typeof value["text"] === "string" && typeof value["href"] === "string" && (typeof value["personId"] === "string" || value["personId"] === null) && typeof value["ariaLabel"] === "string" && typeof value["role"] === "string" && typeof value["context"] === "string";
  }
  function getString(value) {
    return typeof value === "string" ? value : "";
  }
  function getNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }
  function getBoolean(value) {
    return typeof value === "boolean" ? value : false;
  }
  function getStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  }
  function toMessageEnvelope(message) {
    return isRecord(message) ? {
      type: message["type"],
      payload: isRecord(message["payload"]) ? message["payload"] : void 0
    } : {};
  }
})();
