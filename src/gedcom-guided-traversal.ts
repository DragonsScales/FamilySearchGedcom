import type {
  FamilySearchCapturedRelationship
} from './Interfaces/familysearch-person.interface';
import type {
  NormalizedGedcomDocument,
  NormalizedGedcomFact,
  NormalizedGedcomFamily,
  NormalizedGedcomPerson
} from './Interfaces/gedcom.interface';

export type GedcomTraversalBranch = 'root' | 'ancestor' | 'descendant';
export type GedcomTraversalRelationship = 'father' | 'mother' | 'spouse' | 'child';
export type GedcomTraversalMatchStatus = 'matched' | 'missing' | 'ambiguous';

export interface GedcomTraversalMatch {
  status: 'matched';
  gedcomPersonId: string;
  familySearchId: string;
  name: string;
  relationshipHint: GedcomTraversalRelationship;
  branch: GedcomTraversalBranch;
  matchNote: string;
}

export interface GedcomTraversalUnmatched {
  status: 'missing' | 'ambiguous';
  gedcomPersonId: string;
  name: string;
  relationshipHint: GedcomTraversalRelationship;
  branch: GedcomTraversalBranch;
  matchNote: string;
}

export interface GedcomTraversalRoute {
  matches: GedcomTraversalMatch[];
  unmatched: GedcomTraversalUnmatched[];
}

export interface GedcomTraversalRouteInput {
  document: NormalizedGedcomDocument;
  currentGedcomPersonId: string;
  currentBranch: GedcomTraversalBranch;
  relationships: FamilySearchCapturedRelationship[];
  seenGedcomPersonIds: readonly string[];
  seenFamilySearchIds: readonly string[];
}

interface ExpectedGedcomRelative {
  gedcomPersonId: string;
  name: string;
  relationshipHint: GedcomTraversalRelationship;
  branch: GedcomTraversalBranch;
  birthDate: string;
  trustRelationshipHint: boolean;
}

interface RelationshipMatchResult {
  relationship?: FamilySearchCapturedRelationship;
  status: GedcomTraversalMatchStatus;
  note: string;
}

export function buildGedcomTraversalRoute(input: GedcomTraversalRouteInput): GedcomTraversalRoute {
  const expectedRelatives = buildExpectedGedcomRelatives(
    input.document,
    input.currentGedcomPersonId,
    input.currentBranch
  );
  const seenGedcomIds = new Set(input.seenGedcomPersonIds);
  const seenFamilySearchIds = new Set(input.seenFamilySearchIds);
  const matchedPageFamilySearchIds = new Set<string>();
  const route: GedcomTraversalRoute = {
    matches: [],
    unmatched: []
  };

  for (const expected of expectedRelatives) {
    if (seenGedcomIds.has(expected.gedcomPersonId)) continue;

    const result = matchRelationship(expected, input.relationships, matchedPageFamilySearchIds);
    if (!result.relationship) {
      route.unmatched.push({
        status: result.status === 'ambiguous' ? 'ambiguous' : 'missing',
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
      status: 'matched',
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

function buildExpectedGedcomRelatives(
  document: NormalizedGedcomDocument,
  currentGedcomPersonId: string,
  currentBranch: GedcomTraversalBranch
): ExpectedGedcomRelative[] {
  const personById = new Map(document.people.map((person) => [person.id, person]));
  const familyById = new Map(document.families.map((family) => [family.id, family]));
  const currentPerson = personById.get(currentGedcomPersonId);
  if (!currentPerson) return [];

  const relatives: ExpectedGedcomRelative[] = [];
  const shouldExpandParents = currentBranch !== 'descendant';

  if (shouldExpandParents) {
    relatives.push(...buildParentRelatives(currentPerson, personById, familyById));
  }

  relatives.push(...buildSpouseRelatives(currentPerson, currentBranch, personById, familyById));
  relatives.push(...buildChildRelatives(currentPerson, personById, familyById));

  return dedupeExpectedRelatives(relatives);
}

function buildParentRelatives(
  person: NormalizedGedcomPerson,
  personById: Map<string, NormalizedGedcomPerson>,
  familyById: Map<string, NormalizedGedcomFamily>
): ExpectedGedcomRelative[] {
  const relatives: ExpectedGedcomRelative[] = [];

  for (const familyId of person.parentFamilyIds) {
    const family = familyById.get(familyId);
    if (!family) continue;

    const husbandIds = getFamilyHusbandIds(family);
    const wifeIds = getFamilyWifeIds(family);
    const father = husbandIds[0] ? personById.get(husbandIds[0]) : undefined;
    const mother = wifeIds[0] ? personById.get(wifeIds[0]) : undefined;
    const sameSexParents = Boolean(
      husbandIds.length > 1 ||
      wifeIds.length > 1 ||
      father?.sex &&
      mother?.sex &&
      normalizeSex(father.sex) === normalizeSex(mother.sex)
    );

    for (const husbandId of husbandIds) {
      const expected = personById.get(husbandId);
      relatives.push(toExpectedRelative(
        husbandId,
        expected,
        'father',
        'ancestor',
        !sameSexParents && normalizeSex(expected?.sex) !== 'F'
      ));
    }

    for (const wifeId of wifeIds) {
      const expected = personById.get(wifeId);
      relatives.push(toExpectedRelative(
        wifeId,
        expected,
        'mother',
        'ancestor',
        !sameSexParents && normalizeSex(expected?.sex) !== 'M'
      ));
    }
  }

  return relatives;
}

function buildSpouseRelatives(
  person: NormalizedGedcomPerson,
  currentBranch: GedcomTraversalBranch,
  personById: Map<string, NormalizedGedcomPerson>,
  familyById: Map<string, NormalizedGedcomFamily>
): ExpectedGedcomRelative[] {
  const branch: GedcomTraversalBranch = currentBranch === 'ancestor' ? 'ancestor' : 'descendant';
  const relatives: ExpectedGedcomRelative[] = [];

  for (const familyId of person.spouseFamilyIds) {
    const family = familyById.get(familyId);
    if (!family) continue;

    for (const spouseId of getFamilySpouseIds(family)) {
      if (!spouseId || spouseId === person.id) continue;
      relatives.push(toExpectedRelative(
        spouseId,
        personById.get(spouseId),
        'spouse',
        branch,
        true
      ));
    }
  }

  return relatives;
}

function buildChildRelatives(
  person: NormalizedGedcomPerson,
  personById: Map<string, NormalizedGedcomPerson>,
  familyById: Map<string, NormalizedGedcomFamily>
): ExpectedGedcomRelative[] {
  const relatives: ExpectedGedcomRelative[] = [];

  for (const familyId of person.spouseFamilyIds) {
    const family = familyById.get(familyId);
    if (!family) continue;

    for (const childId of family.childIds) {
      relatives.push(toExpectedRelative(
        childId,
        personById.get(childId),
        'child',
        'descendant',
        true
      ));
    }
  }

  return relatives;
}

function toExpectedRelative(
  gedcomPersonId: string,
  person: NormalizedGedcomPerson | undefined,
  relationshipHint: GedcomTraversalRelationship,
  branch: GedcomTraversalBranch,
  trustRelationshipHint: boolean
): ExpectedGedcomRelative {
  return {
    gedcomPersonId,
    name: getPrimaryName(person) || gedcomPersonId,
    relationshipHint,
    branch,
    birthDate: getBirthDate(person),
    trustRelationshipHint
  };
}

function dedupeExpectedRelatives(relatives: ExpectedGedcomRelative[]): ExpectedGedcomRelative[] {
  const seen = new Set<string>();
  const deduped: ExpectedGedcomRelative[] = [];

  for (const relative of relatives) {
    if (seen.has(relative.gedcomPersonId)) continue;
    seen.add(relative.gedcomPersonId);
    deduped.push(relative);
  }

  return deduped;
}

function matchRelationship(
  expected: ExpectedGedcomRelative,
  relationships: FamilySearchCapturedRelationship[],
  matchedPageFamilySearchIds: Set<string>
): RelationshipMatchResult {
  const unusedRelationships = relationships.filter((relationship) => (
    relationship.personId &&
    !matchedPageFamilySearchIds.has(relationship.personId)
  ));
  const candidates = unusedRelationships.filter((relationship) => relationshipMatchesExpectedKind(expected, relationship));

  if (candidates.length === 0) {
    return {
      status: 'missing',
      note: `No FamilySearch ${expected.relationshipHint} relationship with a usable ID was found.`
    };
  }

  if (candidates.length === 1) {
    return {
      relationship: candidates[0],
      status: 'matched',
      note: `Matched the only visible FamilySearch ${expected.relationshipHint}.`
    };
  }

  const firstNameMatches = candidates.filter((relationship) => (
    normalizeFirstName(relationship.name) === normalizeFirstName(expected.name)
  ));

  if (firstNameMatches.length === 1) {
    return {
      relationship: firstNameMatches[0],
      status: 'matched',
      note: 'Matched by first name.'
    };
  }

  const datePool = firstNameMatches.length > 1 ? firstNameMatches : candidates;
  const birthDateMatches = datePool.filter((relationship) => birthDatesMatch(expected.birthDate, relationship.context));

  if (birthDateMatches.length === 1) {
    return {
      relationship: birthDateMatches[0],
      status: 'matched',
      note: 'Matched by birth date.'
    };
  }

  if (firstNameMatches.length > 1 || birthDateMatches.length > 1) {
    return {
      status: 'ambiguous',
      note: `Multiple FamilySearch ${expected.relationshipHint} matches were found.`
    };
  }

  return {
    status: 'missing',
    note: `No FamilySearch ${expected.relationshipHint} matched by first name or birth date.`
  };
}

function relationshipMatchesExpectedKind(
  expected: ExpectedGedcomRelative,
  relationship: FamilySearchCapturedRelationship
): boolean {
  const hint = relationship.relationshipHint.toLowerCase();

  if (expected.relationshipHint === 'father') {
    return expected.trustRelationshipHint
      ? hint.includes('father')
      : isParentHint(hint);
  }

  if (expected.relationshipHint === 'mother') {
    return expected.trustRelationshipHint
      ? hint.includes('mother')
      : isParentHint(hint);
  }

  if (expected.relationshipHint === 'spouse') {
    return hint.includes('spouse') || hint.includes('wife') || hint.includes('husband');
  }

  return hint.includes('child') || hint.includes('son') || hint.includes('daughter');
}

function isParentHint(hint: string): boolean {
  return hint.includes('parent') || hint.includes('father') || hint.includes('mother');
}

function birthDatesMatch(gedcomBirthDate: string, relationshipContext: string): boolean {
  const gedcomYear = extractYear(gedcomBirthDate);
  const relationshipYear = extractRelationshipBirthYear(relationshipContext);
  return Boolean(gedcomYear && relationshipYear && gedcomYear === relationshipYear);
}

function extractRelationshipBirthYear(context: string): string {
  const lifeSpan = context
    .split('|')
    .map((part) => part.trim())
    .find((part) => /\d{3,4}\s*(?:[\u2013-]|$)/.test(part));

  return extractYear(lifeSpan ?? context);
}

function extractYear(value: string): string {
  return String(value ?? '').match(/\b\d{3,4}\b/)?.[0] ?? '';
}

function getPrimaryName(person: NormalizedGedcomPerson | undefined): string {
  const name = person?.names[0];
  if (!name) return '';
  if (name.given || name.surname) return [name.given, name.surname].filter(Boolean).join(' ').trim();
  return name.full;
}

function normalizeFirstName(value: string): string {
  return String(value ?? '')
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^A-Za-z]/g, '')
    .toLowerCase() ?? '';
}

function getBirthDate(person: NormalizedGedcomPerson | undefined): string {
  return findFact(person, 'BIRT')?.date ?? '';
}

function findFact(person: NormalizedGedcomPerson | undefined, type: string): NormalizedGedcomFact | undefined {
  return person?.facts.find((fact) => fact.type === type);
}

function normalizeSex(value: string | undefined): 'M' | 'F' | '' {
  const normalized = value?.toUpperCase();
  if (normalized === 'M' || normalized === 'F') return normalized;
  return '';
}

function getFamilySpouseIds(family: NormalizedGedcomFamily): string[] {
  return [
    ...getFamilyHusbandIds(family),
    ...getFamilyWifeIds(family)
  ];
}

function getFamilyHusbandIds(family: NormalizedGedcomFamily): string[] {
  return family.husbandIds ?? [family.husbandId].filter((id): id is string => Boolean(id));
}

function getFamilyWifeIds(family: NormalizedGedcomFamily): string[] {
  return family.wifeIds ?? [family.wifeId].filter((id): id is string => Boolean(id));
}
