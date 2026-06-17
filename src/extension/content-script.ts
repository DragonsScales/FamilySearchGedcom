import { cleanText, isRecord } from './helpers';

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
  raw: {
    headings: string[];
    visibleTextSample: string[];
  };
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

const PERSON_URL_PATTERN = /\/tree\/person\/(?:details|about|timeline|sources|memories|ordinances|collaborate)\/([A-Z0-9-]+)/i;
const FAMILYSEARCH_ID_PATTERN = /\b[A-Z0-9]{4}-[A-Z0-9]{3}\b/g;
const FACT_LABELS = [
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
  'Occupation'
];

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isCaptureMessage(message)) return false;

  try {
    sendResponse({ ok: true, capture: captureVisibleFamilySearchPage() });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not capture this page.'
    });
  }

  return true;
});

function isCaptureMessage(message: unknown): message is { type: 'FS_CAPTURE_PAGE' } {
  return isRecord(message) && message['type'] === 'FS_CAPTURE_PAGE';
}

function captureVisibleFamilySearchPage(): FamilySearchPageCapture {
  const root = document.querySelector<HTMLElement>('main') ?? document.body;
  const lines = uniqueTextLines(root.innerText);
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
    raw: {
      headings: extractHeadings(root),
      visibleTextSample: lines.slice(0, 120)
    }
  };
}

function extractPersonId(url: string): string | null {
  const match = String(url).match(PERSON_URL_PATTERN);
  return match?.[1]?.toUpperCase() ?? null;
}

function extractDisplayName(root: HTMLElement, lines: string[]): string {
  const heading = root.querySelector<HTMLElement>('h1');
  const headingText = cleanText(heading?.innerText);
  if (headingText && !/familysearch|person/i.test(headingText)) return headingText;

  const titleName = cleanText(document.title).replace(/\s*\|\s*FamilySearch.*$/i, '');
  if (titleName && !/familysearch/i.test(titleName)) return titleName;

  return lines.find((line) => line.length > 2 && line.length < 100) ?? '';
}

function extractHeadings(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('h1, h2, h3, [role="heading"]')]
    .map((element) => cleanText(element.innerText))
    .filter(Boolean)
    .slice(0, 80);
}

function extractFacts(lines: string[]): CapturedFact[] {
  const facts: CapturedFact[] = [];
  const labelSet = new Set(FACT_LABELS.map((label) => label.toLowerCase()));

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const label = FACT_LABELS.find((candidate) => {
      const lower = line.toLowerCase();
      return lower === candidate.toLowerCase() || lower.startsWith(`${candidate.toLowerCase()} `);
    });

    if (!label) continue;

    if (line.length > label.length + 1) {
      facts.push({
        type: label,
        values: [line.slice(label.length).trim()].filter(Boolean),
        rawText: line
      });
      continue;
    }

    const values: string[] = [];
    for (let offset = 1; offset <= 4; offset += 1) {
      const nextLine = lines[index + offset];
      if (!nextLine) break;
      if (labelSet.has(nextLine.toLowerCase())) break;
      if (/^(parents|spouses|children|siblings|sources|memories|collaborate)$/i.test(nextLine)) break;
      values.push(nextLine);
    }

    if (values.length > 0) {
      facts.push({
        type: label,
        values,
        rawText: [line, ...values].join(' | ')
      });
    }
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
      url: `https://www.familysearch.org/en/tree/person/details/${personId}`,
      context: context.slice(0, 500)
    });
  }

  for (const relationship of extractRelationshipsFromVisibleText(lines, currentPersonId)) {
    upsertRelationship(relationshipById, relationship.personId, relationship);
  }

  return [...relationshipById.values()].slice(0, 200);
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
        url: `https://www.familysearch.org/en/tree/person/details/${personId}`,
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
    name: existing?.name || relationship.name || '',
    relationshipHint: existing?.relationshipHint || relationship.relationshipHint || '',
    url: relationship.url,
    context: existing?.context || relationship.context || ''
  });
}

function extractFamilySearchIds(value: string): string[] {
  return value.match(/\b[A-Z0-9]{4}-[A-Z0-9]{3}\b/g)?.map((id) => id.toUpperCase()) ?? [];
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
  if (!value || value.length < 2 || value.length > 80) return false;
  if (FAMILYSEARCH_ID_PATTERN.test(value)) {
    FAMILYSEARCH_ID_PATTERN.lastIndex = 0;
    return false;
  }
  FAMILYSEARCH_ID_PATTERN.lastIndex = 0;

  if (/^(family members|parents and siblings|spouses and children|parents|siblings|spouses|children)$/i.test(value)) return false;
  if (/^(birth|christening|death|burial|residence|sources|memories|collaborate|time line|print options)$/i.test(value)) return false;
  if (/^\d{3,4}$/.test(value)) return false;
  return /[A-Za-z]/.test(value);
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

  for (const line of text.split('\n')) {
    const cleaned = cleanText(line);
    if (!cleaned || cleaned.length > 250 || seen.has(cleaned)) continue;
    seen.add(cleaned);
    lines.push(cleaned);
  }

  return lines;
}
