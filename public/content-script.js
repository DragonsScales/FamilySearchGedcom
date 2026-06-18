"use strict";
(() => {
  // src/extension/helpers.ts
  function cleanText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
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

  // src/extension/content-script.ts
  var FAMILYSEARCH_ID_PATTERN = /\b[A-Z0-9]{4}-[A-Z0-9]{3}\b/g;
  var PERSON_LIFE_DATE_SOURCE = "(?:\\d{1,2}\\s+[A-Za-z]+\\s+)?\\d{3,4}";
  var PERSON_LIFE_ENDPOINT_SOURCE = `(?:${PERSON_LIFE_DATE_SOURCE}|Living|Deceased)`;
  var PERSON_LIFE_DETAIL_SOURCE = `(?:Living|Deceased|${PERSON_LIFE_DATE_SOURCE}\\s*[\u2013-]\\s*${PERSON_LIFE_ENDPOINT_SOURCE}?|[\u2013-]\\s*${PERSON_LIFE_ENDPOINT_SOURCE})`;
  var PERSON_LIFE_DETAIL_PATTERN = new RegExp(`^${PERSON_LIFE_DETAIL_SOURCE}$`, "i");
  var PERSON_HEADING_TRAILER_PATTERN = new RegExp(
    `\\s+(?:Male|Female|Unknown)\\s+${PERSON_LIFE_DETAIL_SOURCE}\\s+\u2022\\s+[A-Z0-9]{4}-[A-Z0-9]{3}$`,
    "i"
  );
  var PERSON_GENDER_LIFE_TRAILER_PATTERN = new RegExp(
    `\\s+(?:Male|Female|Unknown)\\s+${PERSON_LIFE_DETAIL_SOURCE}$`,
    "i"
  );
  var FACT_LABELS = [
    "Name",
    "Sex",
    "Birth",
    "Christening",
    "Death",
    "Burial",
    "Residence",
    "Marriage",
    "Divorce",
    "Census",
    "Immigration",
    "Emigration",
    "Military Service",
    "Naturalization",
    "Probate",
    "Occupation",
    "Custom Event"
  ];
  var FACT_SECTION_STOPS = [
    "Other Information",
    "Alternate Names",
    "Events",
    "Facts",
    "Family Members",
    "Spouses and Children",
    "Parents and Siblings",
    "Other Relationships",
    "Brief Life History"
  ];
  var PAGE_READY_TIMEOUT_MS = 6e4;
  var PAGE_QUIET_WINDOW_MS = 750;
  var PAGE_READY_POLL_MS = 250;
  var DEBUG_TEXT_SAMPLE_LIMIT = 12e3;
  var DEBUG_HTML_SAMPLE_LIMIT = 2e4;
  var DEBUG_LINK_LIMIT = 200;
  var networkActivityTracker = installNetworkActivityTracker();
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
          error: error instanceof Error ? error.message : "Could not capture this page."
        });
      }
    })();
    return true;
  });
  function isCaptureMessage(message) {
    return isRecord(message) && message["type"] === "FS_CAPTURE_PAGE";
  }
  function captureVisibleFamilySearchPage(expectedFamilySearchId) {
    const root = document.querySelector("main") ?? document.body;
    const lines = textLines(root.innerText);
    const familySearchId = extractPersonId(window.location.href);
    return {
      schemaVersion: 1,
      source: "familysearch-visible-page",
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
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
  async function waitForFamilySearchPageReady(expectedFamilySearchId) {
    const startedAt = Date.now();
    let readiness2 = inspectPageReadiness(expectedFamilySearchId);
    while (Date.now() - startedAt < PAGE_READY_TIMEOUT_MS) {
      readiness2 = inspectPageReadiness(expectedFamilySearchId);
      if (readiness2.ready) return;
      await delay(PAGE_READY_POLL_MS);
    }
    throw new Error(`Timed out waiting for the FamilySearch person page to finish loading: ${readiness2.reason}`);
  }
  function inspectPageReadiness(expectedFamilySearchId) {
    const root = document.querySelector("main") ?? document.body;
    const bodyText = cleanText(document.body?.innerText);
    const mainText = cleanText(root.innerText);
    const lines = textLines(root.innerText);
    const loadingSkeletonCount = countLoadingSkeletons(root);
    const hasExpectedFamilySearchId = expectedFamilySearchId ? bodyText.toUpperCase().includes(expectedFamilySearchId) : false;
    const hasPersonHeading = hasVisiblePersonHeading(root, lines);
    const capturedFactCount = extractFacts(lines).length;
    const capturedRelationshipCount = extractRelationshipBlocks(lines, extractPersonId(window.location.href)).length;
    const hasCaptureablePersonDetails = capturedFactCount > 0 || capturedRelationshipCount > 0;
    const hasPersonLinks = root.querySelector('a[href*="/tree/person/"]') !== null;
    const networkIsQuiet = networkActivityTracker.isIdle(PAGE_QUIET_WINDOW_MS);
    if (document.readyState !== "complete") {
      return readiness(false, "document is still loading", expectedFamilySearchId, hasExpectedFamilySearchId, loadingSkeletonCount);
    }
    if (mainText.length === 0) {
      return readiness(false, "main content is empty", expectedFamilySearchId, hasExpectedFamilySearchId, loadingSkeletonCount);
    }
    if (expectedFamilySearchId && !hasExpectedFamilySearchId) {
      return readiness(false, `expected ID ${expectedFamilySearchId} is not visible yet`, expectedFamilySearchId, hasExpectedFamilySearchId, loadingSkeletonCount);
    }
    if (loadingSkeletonCount > 0) {
      return readiness(false, `still showing ${loadingSkeletonCount} loading skeleton element(s)`, expectedFamilySearchId, hasExpectedFamilySearchId, loadingSkeletonCount);
    }
    if (!hasCaptureablePersonDetails) {
      return readiness(false, "person detail cards are still loading", expectedFamilySearchId, hasExpectedFamilySearchId, loadingSkeletonCount);
    }
    if (!networkIsQuiet && !hasPersonHeading) {
      return readiness(false, "network activity is still settling", expectedFamilySearchId, hasExpectedFamilySearchId, loadingSkeletonCount);
    }
    return readiness(true, "person content appears ready", expectedFamilySearchId, hasExpectedFamilySearchId, loadingSkeletonCount);
  }
  function readiness(ready, reason, expectedFamilySearchId, hasExpectedFamilySearchId, loadingSkeletonCount) {
    return {
      ready,
      reason,
      expectedFamilySearchId,
      hasExpectedFamilySearchId,
      loadingSkeletonCount
    };
  }
  function extractPersonId(url) {
    return extractFamilySearchPersonIdFromUrl(url);
  }
  function installNetworkActivityTracker() {
    const trackedWindow = window;
    if (trackedWindow.__familySearchNetworkActivityTracker__) {
      return trackedWindow.__familySearchNetworkActivityTracker__;
    }
    let inFlight = 0;
    let lastActivityAt = Date.now();
    const markActivity = () => {
      lastActivityAt = Date.now();
    };
    const increment = () => {
      inFlight += 1;
      markActivity();
    };
    const decrement = () => {
      inFlight = Math.max(0, inFlight - 1);
      markActivity();
    };
    if (typeof window.fetch === "function") {
      const originalFetch = window.fetch.bind(window);
      const wrappedFetch = async (...args) => {
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
    XMLHttpRequest.prototype.send = function(...args) {
      increment();
      const onLoadEnd = () => {
        this.removeEventListener("loadend", onLoadEnd);
        decrement();
      };
      this.addEventListener("loadend", onLoadEnd);
      try {
        return originalSend.apply(this, args);
      } catch (error) {
        this.removeEventListener("loadend", onLoadEnd);
        decrement();
        throw error;
      }
    };
    if (typeof PerformanceObserver === "function") {
      try {
        const observer = new PerformanceObserver((list) => {
          if (list.getEntries().length > 0) markActivity();
        });
        observer.observe({ type: "resource", buffered: true });
      } catch {
      }
    }
    const tracker = {
      getSnapshot: () => ({ inFlight, lastActivityAt }),
      isIdle: (quietWindowMs) => inFlight === 0 && Date.now() - lastActivityAt >= quietWindowMs
    };
    trackedWindow.__familySearchNetworkActivityTracker__ = tracker;
    return tracker;
  }
  function extractDisplayName(root, lines) {
    const headerName = extractHeaderPersonName(lines);
    if (headerName) return headerName;
    const heading = root.querySelector("h1");
    const headingText = cleanText(heading?.innerText);
    const parsedHeading = cleanPersonName(headingText);
    if (parsedHeading && !/familysearch|person/i.test(parsedHeading) && !isShellHeading(parsedHeading)) {
      return parsedHeading;
    }
    const titleName = cleanTitleName(document.title);
    if (titleName && !/familysearch/i.test(titleName)) return titleName;
    return lines.find((line) => line.length > 2 && line.length < 100 && !isShellHeading(line)) ?? "";
  }
  function hasVisiblePersonHeading(root, lines) {
    if (extractHeaderPersonName(lines)) return true;
    const heading = root.querySelector("h1");
    const headingText = cleanPersonName(cleanText(heading?.innerText));
    return Boolean(headingText && !/familysearch|person/i.test(headingText) && !isShellHeading(headingText));
  }
  function extractHeadings(root) {
    return [...root.querySelectorAll('h1, h2, h3, [role="heading"]')].map((element) => cleanText(element.innerText)).filter(Boolean).slice(0, 80);
  }
  function buildDebugSnapshot(root, lines, expectedFamilySearchId) {
    const bodyText = document.body?.innerText ?? "";
    const mainText = root.innerText ?? "";
    const readiness2 = inspectPageReadiness(expectedFamilySearchId);
    return {
      url: window.location.href,
      title: document.title,
      expectedFamilySearchId,
      documentReadyState: document.readyState,
      readinessReason: readiness2.reason,
      loadingSkeletonCount: readiness2.loadingSkeletonCount,
      hasExpectedFamilySearchId: readiness2.hasExpectedFamilySearchId,
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
  function extractDebugLinks(root) {
    return [...root.querySelectorAll('a[href*="/tree/person/"]')].slice(0, DEBUG_LINK_LIMIT).map((anchor) => ({
      text: cleanText(anchor.innerText),
      href: anchor.href,
      personId: extractPersonId(anchor.href),
      ariaLabel: cleanText(anchor.getAttribute("aria-label")),
      role: cleanText(anchor.getAttribute("role")),
      context: nearestUsefulContext(anchor).slice(0, 500)
    }));
  }
  function truncateForDebug(value, limit) {
    if (value.length <= limit) return value;
    return `${value.slice(0, limit)}
...[truncated ${value.length - limit} character(s)]`;
  }
  function countLoadingSkeletons(root) {
    return root.querySelectorAll([
      '[data-testid*="loading-skeleton"]',
      '[class*="skeletonCss"]',
      '[class*="Skeleton"]',
      '[aria-busy="true"]'
    ].join(",")).length;
  }
  function isShellHeading(value) {
    return /^(vitals|detail view|other information|alternate names|events|facts|family members|show all family members|spouses and children|parents and siblings|other relationships|brief life history|children|parents|siblings|spouses|add child|add spouse|add parent|add other relationship)$/i.test(value);
  }
  function extractFacts(lines) {
    const facts = [];
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
        rawText: [line, ...rawValues].join(" | ")
      });
    }
    return facts.slice(0, 120);
  }
  function extractRelationships(root, currentPersonId, lines) {
    const relationshipById = /* @__PURE__ */ new Map();
    const anchors = [...root.querySelectorAll('a[href*="/tree/person/"]')];
    for (const anchor of anchors) {
      const personId = extractPersonId(anchor.href);
      if (!personId || personId === currentPersonId) continue;
      const name = cleanText(anchor.innerText || anchor.getAttribute("aria-label"));
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
  function extractRelationshipBlocks(lines, currentPersonId) {
    const relationships = [];
    let section = null;
    let relationshipHint = null;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^Spouses and Children$/i.test(line)) {
        section = "spouses-and-children";
        relationshipHint = "spouse";
        continue;
      }
      if (/^Parents and Siblings$/i.test(line)) {
        section = "parents-and-siblings";
        relationshipHint = "parent";
        continue;
      }
      if (/^Other Relationships$/i.test(line) || /^Brief Life History$/i.test(line)) {
        section = null;
        relationshipHint = null;
        continue;
      }
      if (!section || !relationshipHint) continue;
      if (/^Children(?:\s+\(\d+\))?$/i.test(line)) {
        relationshipHint = section === "spouses-and-children" ? "child" : "sibling";
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
          context: lines.slice(index, personBlock.endIndex + 1).join(" | ")
        });
      }
      index = personBlock.endIndex;
    }
    return relationships;
  }
  function extractRelationshipsFromVisibleText(lines, currentPersonId) {
    const relationships = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const ids = extractFamilySearchIds(line).filter((personId) => personId !== currentPersonId);
      for (const personId of ids) {
        const contextLines = lines.slice(Math.max(0, index - 5), Math.min(lines.length, index + 6));
        const context = contextLines.join(" | ");
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
  function upsertRelationship(relationshipById, personId, relationship) {
    const existing = relationshipById.get(personId);
    relationshipById.set(personId, {
      personId,
      name: chooseRelationshipName(existing?.name ?? "", relationship.name || ""),
      relationshipHint: chooseRelationshipHint(existing?.relationshipHint ?? "", relationship.relationshipHint || ""),
      url: relationship.url,
      context: chooseLongerText(existing?.context ?? "", relationship.context || "")
    });
  }
  function extractFamilySearchIds(value) {
    return value.match(/\b[A-Z0-9]{4}-[A-Z0-9]{3}\b/g)?.map((id) => id.toUpperCase()) ?? [];
  }
  function matchFactLabel(line) {
    const normalized = line.replace(/\s*•\s*\d+\s+Sources?.*$/i, "").trim();
    return FACT_LABELS.find((label) => normalized.toLowerCase() === label.toLowerCase() || normalized.toLowerCase().startsWith(`${label.toLowerCase()} `)) ?? null;
  }
  function collectFactRawValues(lines, startIndex) {
    const values = [];
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
  function toFactValues(label, rawValues) {
    const cleanedValues = rawValues.filter((value) => !isFactNoise(value));
    if (cleanedValues.length === 0) return [];
    if (label === "Name") return [`Value: ${cleanPersonName(cleanedValues[0]) || cleanedValues[0]}`];
    if (label === "Sex") return [`Value: ${cleanedValues[0]}`];
    if (label === "Custom Event") {
      return [
        `Value: ${cleanedValues[0]}`,
        ...toDatePlaceValues(cleanedValues.slice(1))
      ];
    }
    return toDatePlaceValues(cleanedValues);
  }
  function toDatePlaceValues(values) {
    const [date, place, ...extraValues] = values;
    return [
      date ? `Date: ${date}` : "",
      place ? `Place: ${place}` : "",
      ...extraValues.map((value) => `Value: ${value}`)
    ].filter(Boolean);
  }
  function isFactNoise(value) {
    return /^(Last Changed:|Reason:|MORE$|ADD$)/i.test(value) || /^[A-Z]$/.test(value);
  }
  function isFactSectionStop(line) {
    return FACT_SECTION_STOPS.some((section) => section.toLowerCase() === line.toLowerCase());
  }
  function parsePersonBlock(lines, startIndex) {
    const name = cleanPersonName(lines[startIndex]);
    if (!looksLikePersonName(name)) return null;
    let gender = "";
    let lifeSpan = "";
    let personId = "";
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
      if (line === "\u2022") {
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
  function refineRelationshipHint(relationshipHint, gender) {
    const normalizedGender = gender.toLowerCase();
    if (relationshipHint === "parent" && normalizedGender === "male") return "father";
    if (relationshipHint === "parent" && normalizedGender === "female") return "mother";
    if (relationshipHint === "child" && normalizedGender === "male") return "son";
    if (relationshipHint === "child" && normalizedGender === "female") return "daughter";
    if (relationshipHint === "spouse" && normalizedGender === "male") return "husband";
    if (relationshipHint === "spouse" && normalizedGender === "female") return "wife";
    return relationshipHint;
  }
  function extractHeaderPersonName(lines) {
    const [name, gender, lifespan, bullet, personId] = lines;
    if (looksLikePersonName(name ?? "") && /^(Male|Female|Unknown)$/i.test(gender ?? "") && isPersonLifeDetail(lifespan ?? "") && bullet === "\u2022" && extractFamilySearchIds(personId ?? "").length > 0) {
      return cleanPersonName(name);
    }
    return "";
  }
  function cleanPersonName(value) {
    return cleanText(value).replace(PERSON_HEADING_TRAILER_PATTERN, "").replace(PERSON_GENDER_LIFE_TRAILER_PATTERN, "").replace(/\s+•\s+[A-Z0-9]{4}-[A-Z0-9]{3}$/i, "").replace(/\s+[A-Z0-9]{4}-[A-Z0-9]{3}$/i, "").replace(/\s+•\s*$/i, "").trim();
  }
  function cleanTitleName(value) {
    return cleanText(value).replace(/\s*\|\s*FamilySearch.*$/i, "").replace(/\s*•\s*Person\s*•\s*Family Tree.*$/i, "").replace(/\s*\([^)]*\)\s*$/i, "").trim();
  }
  function looksLikeRelationshipContext(context) {
    const lower = context.toLowerCase();
    return [
      "family members",
      "parents and siblings",
      "spouses and children",
      "parent",
      "mother",
      "father",
      "sibling",
      "spouse",
      "wife",
      "husband",
      "child",
      "children",
      "son",
      "daughter"
    ].some((term) => lower.includes(term));
  }
  function inferNameNearId(lines, index, personId) {
    const sameLineName = cleanText(lines[index].replace(personId, "").replace(/\b(deceased|living)\b/gi, ""));
    if (looksLikePersonName(sameLineName)) return sameLineName;
    for (let offset = 1; offset <= 3; offset += 1) {
      const previous = cleanText(lines[index - offset]);
      if (looksLikePersonName(previous)) return previous;
    }
    for (let offset = 1; offset <= 2; offset += 1) {
      const next = cleanText(lines[index + offset]);
      if (looksLikePersonName(next)) return next;
    }
    return "";
  }
  function looksLikePersonName(value) {
    if (!value || value.length < 2 || value.length > 80) return false;
    if (/^(Male|Female|Unknown|Living|•)$/i.test(value)) return false;
    if (isPersonLifeDetail(value)) return false;
    if (FAMILYSEARCH_ID_PATTERN.test(value)) {
      FAMILYSEARCH_ID_PATTERN.lastIndex = 0;
      return false;
    }
    FAMILYSEARCH_ID_PATTERN.lastIndex = 0;
    if (isShellHeading(value)) return false;
    if (/^(birth|christening|death|burial|residence|sources|memories|collaborate|time line|print options|quality score:|not available at this time)$/i.test(value)) return false;
    if (/^\d{3,4}$/.test(value)) return false;
    return /[A-Za-z]/.test(value);
  }
  function isPersonLifeDetail(value) {
    return PERSON_LIFE_DETAIL_PATTERN.test(cleanText(value));
  }
  function chooseRelationshipName(existingName, nextName) {
    if (!existingName) return nextName;
    if (!nextName) return existingName;
    if (!looksLikePersonName(existingName) && looksLikePersonName(nextName)) return nextName;
    if (nextName.length > existingName.length && looksLikePersonName(nextName)) return nextName;
    return existingName;
  }
  function chooseRelationshipHint(existingHint, nextHint) {
    if (!existingHint) return nextHint;
    if (!nextHint) return existingHint;
    return relationshipHintSpecificity(nextHint) > relationshipHintSpecificity(existingHint) ? nextHint : existingHint;
  }
  function relationshipHintSpecificity(relationshipHint) {
    if (!relationshipHint) return 0;
    if (["parents-and-siblings", "spouses-and-children"].includes(relationshipHint)) return 1;
    if (["parent", "spouse", "child", "sibling"].includes(relationshipHint)) return 2;
    return 3;
  }
  function chooseLongerText(existingText, nextText) {
    return nextText.length > existingText.length ? nextText : existingText;
  }
  function nearestUsefulContext(element) {
    let node = element;
    for (let depth = 0; depth < 6 && node; depth += 1) {
      const text = cleanText(node.innerText);
      if (text.length > 20 && text.length < 1200) return text;
      node = node.parentElement;
    }
    return cleanText(element.innerText);
  }
  function inferRelationshipHint(context) {
    const lower = context.toLowerCase();
    if (lower.includes("parents and siblings")) return "parents-and-siblings";
    if (lower.includes("spouses and children")) return "spouses-and-children";
    if (lower.includes("father")) return "father";
    if (lower.includes("mother")) return "mother";
    if (lower.includes("wife")) return "wife";
    if (lower.includes("husband")) return "husband";
    if (lower.includes("son")) return "son";
    if (lower.includes("daughter")) return "daughter";
    if (lower.includes("parent")) return "parent";
    if (lower.includes("spouse")) return "spouse";
    if (lower.includes("child") || lower.includes("children")) return "child";
    if (lower.includes("sibling")) return "sibling";
    return "";
  }
  function textLines(text) {
    const lines = [];
    for (const line of text.split("\n")) {
      const cleaned = cleanText(line);
      if (!cleaned || cleaned.length > 250) continue;
      lines.push(cleaned);
    }
    return lines;
  }
  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
})();
