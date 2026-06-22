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
  birthYear: string;
  trustRelationshipHint: boolean;
}

interface RelationshipMatchResult {
  relationship?: FamilySearchCapturedRelationship;
  status: GedcomTraversalMatchStatus;
  note: string;
}

interface ExpectedRelationshipMatchResult {
  expected: ExpectedGedcomRelative;
  result: RelationshipMatchResult;
}

interface RelationshipAssignment {
  expected: ExpectedGedcomRelative;
  relationship: FamilySearchCapturedRelationship;
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

  for (let index = 0; index < expectedRelatives.length; index += 1) {
    const expected = expectedRelatives[index];
    if (expected.relationshipHint === 'child') {
      const childRelatives: ExpectedGedcomRelative[] = [];

      while (index < expectedRelatives.length && expectedRelatives[index].relationshipHint === 'child') {
        childRelatives.push(expectedRelatives[index]);
        index += 1;
      }

      index -= 1;

      for (const match of matchChildRelationships(
        childRelatives.filter((child) => !seenGedcomIds.has(child.gedcomPersonId)),
        childRelatives,
        input.relationships,
        matchedPageFamilySearchIds,
        seenFamilySearchIds
      )) {
        applyMatchResult(match.expected, match.result, route, seenGedcomIds, seenFamilySearchIds, matchedPageFamilySearchIds);
      }

      continue;
    }

    if (seenGedcomIds.has(expected.gedcomPersonId)) continue;

    const result = matchRelationship(expected, input.relationships, matchedPageFamilySearchIds, seenFamilySearchIds);
    applyMatchResult(expected, result, route, seenGedcomIds, seenFamilySearchIds, matchedPageFamilySearchIds);
  }

  return route;
}

function applyMatchResult(
  expected: ExpectedGedcomRelative,
  result: RelationshipMatchResult,
  route: GedcomTraversalRoute,
  seenGedcomIds: Set<string>,
  seenFamilySearchIds: Set<string>,
  matchedPageFamilySearchIds: Set<string>
): void {
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
    return;
  }

  if (seenFamilySearchIds.has(result.relationship.personId)) {
    seenGedcomIds.add(expected.gedcomPersonId);
    return;
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
    birthYear: getBirthYear(person),
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

function matchChildRelationships(
  expectedChildren: ExpectedGedcomRelative[],
  familyExpectedChildren: ExpectedGedcomRelative[],
  relationships: FamilySearchCapturedRelationship[],
  matchedPageFamilySearchIds: Set<string>,
  seenFamilySearchIds: Set<string>
): ExpectedRelationshipMatchResult[] {
  if (expectedChildren.length === 0) return [];

  const childRelationships = getCandidateRelationships(
    expectedChildren[0],
    relationships,
    matchedPageFamilySearchIds,
    seenFamilySearchIds
  );
  const allChildRelationships = getRelationshipKindCandidates(expectedChildren[0], relationships);

  if (childRelationships.length === 0) {
    return expectedChildren.map((expected) => ({
      expected,
      result: {
        status: 'missing',
        note: 'No FamilySearch child relationship with a usable ID was found.'
      }
    }));
  }

  const assignments: RelationshipAssignment[] = [];
  const assignedGedcomIds = new Set<string>();
  const assignedFamilySearchIds = new Set<string>();
  const appendAssignments = (newAssignments: RelationshipAssignment[]): void => {
    for (const assignment of newAssignments) {
      if (assignedGedcomIds.has(assignment.expected.gedcomPersonId)) continue;
      if (assignedFamilySearchIds.has(assignment.relationship.personId)) continue;
      assignments.push(assignment);
      assignedGedcomIds.add(assignment.expected.gedcomPersonId);
      assignedFamilySearchIds.add(assignment.relationship.personId);
    }
  };
  const remainingExpected = (): ExpectedGedcomRelative[] => expectedChildren.filter((expected) => (
    !assignedGedcomIds.has(expected.gedcomPersonId)
  ));
  const remainingRelationships = (): FamilySearchCapturedRelationship[] => childRelationships.filter((relationship) => (
    !assignedFamilySearchIds.has(relationship.personId)
  ));
  const commonNameTokens = findMostCommonNameTokens([
    ...familyExpectedChildren.map((expected) => expected.name),
    ...allChildRelationships.map((relationship) => relationship.name)
  ]);

  appendAssignments(findUniqueAssignments(
    remainingExpected(),
    remainingRelationships(),
    (expected, relationship) => exactNamesMatch(expected.name, relationship.name),
    'Matched by full name.'
  ));
  appendAssignments(findUniqueAssignments(
    remainingExpected(),
    remainingRelationships(),
    (expected, relationship) => namesShareComparableToken(expected.name, relationship.name, commonNameTokens),
    'Matched by name token.'
  ));
  appendAssignments(findUniqueAssignments(
    remainingExpected(),
    remainingRelationships(),
    (expected, relationship) => birthYearsMatch(expected.birthYear, relationship.context),
    'Matched by birth year range.'
  ));

  const finalExpected = remainingExpected();
  const finalRelationships = remainingRelationships();
  if (finalExpected.length === 1 && finalRelationships.length === 1) {
    appendAssignments([{
      expected: finalExpected[0],
      relationship: finalRelationships[0],
      note: 'Matched the only remaining visible FamilySearch child.'
    }]);
  }

  const assignmentByGedcomId = new Map(assignments.map((assignment) => [
    assignment.expected.gedcomPersonId,
    assignment
  ]));

  return expectedChildren.map((expected) => {
    const assignment = assignmentByGedcomId.get(expected.gedcomPersonId);
    if (assignment) {
      return {
        expected,
        result: {
          relationship: assignment.relationship,
          status: 'matched',
          note: assignment.note
        }
      };
    }

    const unusedRelationships = remainingRelationships();
    const fullNameMatches = unusedRelationships.filter((relationship) => (
      exactNamesMatch(expected.name, relationship.name)
    ));
    const nameTokenMatches = unusedRelationships.filter((relationship) => (
      namesShareComparableToken(expected.name, relationship.name, commonNameTokens)
    ));
    const birthYearMatches = unusedRelationships.filter((relationship) => (
      birthYearsMatch(expected.birthYear, relationship.context)
    ));

    if (fullNameMatches.length > 0 || nameTokenMatches.length > 0 || birthYearMatches.length > 0) {
      return {
        expected,
        result: {
          status: 'ambiguous',
          note: 'Multiple FamilySearch child matches were found.'
        }
      };
    }

    return {
      expected,
      result: {
        status: 'missing',
        note: unusedRelationships.length === 0
          ? 'No FamilySearch child relationship with a usable ID was found.'
          : 'No FamilySearch child matched by name or birth year.'
      }
    };
  });
}

function findUniqueAssignments(
  expectedRelatives: ExpectedGedcomRelative[],
  relationships: FamilySearchCapturedRelationship[],
  matches: (expected: ExpectedGedcomRelative, relationship: FamilySearchCapturedRelationship) => boolean,
  note: string
): RelationshipAssignment[] {
  const relationshipsByExpectedId = new Map<string, FamilySearchCapturedRelationship[]>();
  const expectedIdsByRelationshipId = new Map<string, Set<string>>();

  for (const expected of expectedRelatives) {
    const matchingRelationships = relationships.filter((relationship) => matches(expected, relationship));
    relationshipsByExpectedId.set(expected.gedcomPersonId, matchingRelationships);

    for (const relationship of matchingRelationships) {
      const expectedIds = expectedIdsByRelationshipId.get(relationship.personId) ?? new Set<string>();
      expectedIds.add(expected.gedcomPersonId);
      expectedIdsByRelationshipId.set(relationship.personId, expectedIds);
    }
  }

  return expectedRelatives.flatMap((expected) => {
    const matchingRelationships = relationshipsByExpectedId.get(expected.gedcomPersonId) ?? [];
    if (matchingRelationships.length !== 1) return [];

    const relationship = matchingRelationships[0];
    if ((expectedIdsByRelationshipId.get(relationship.personId)?.size ?? 0) !== 1) return [];

    return [{
      expected,
      relationship,
      note
    }];
  });
}

function matchRelationship(
  expected: ExpectedGedcomRelative,
  relationships: FamilySearchCapturedRelationship[],
  matchedPageFamilySearchIds: Set<string>,
  seenFamilySearchIds: Set<string>
): RelationshipMatchResult {
  const candidates = getCandidateRelationships(expected, relationships, matchedPageFamilySearchIds, seenFamilySearchIds);

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

  const commonNameTokens = findMostCommonNameTokens([
    expected.name,
    ...candidates.map((relationship) => relationship.name)
  ]);
  const fullNameMatches = candidates.filter((relationship) => (
    exactNamesMatch(expected.name, relationship.name)
  ));

  if (fullNameMatches.length === 1) {
    return {
      relationship: fullNameMatches[0],
      status: 'matched',
      note: 'Matched by full name.'
    };
  }

  const nameTokenPool = fullNameMatches.length > 1 ? fullNameMatches : candidates;
  const nameTokenMatches = nameTokenPool.filter((relationship) => (
    namesShareComparableToken(expected.name, relationship.name, commonNameTokens)
  ));

  if (nameTokenMatches.length === 1) {
    return {
      relationship: nameTokenMatches[0],
      status: 'matched',
      note: 'Matched by name token.'
    };
  }

  const birthYearPool = nameTokenMatches.length > 1
    ? nameTokenMatches
    : fullNameMatches.length > 1
      ? fullNameMatches
      : candidates;
  const birthYearMatches = birthYearPool.filter((relationship) => (
    birthYearsMatch(expected.birthYear, relationship.context)
  ));

  if (birthYearMatches.length === 1) {
    return {
      relationship: birthYearMatches[0],
      status: 'matched',
      note: 'Matched by birth year range.'
    };
  }

  if (fullNameMatches.length > 1 || nameTokenMatches.length > 1 || birthYearMatches.length > 1) {
    return {
      status: 'ambiguous',
      note: `Multiple FamilySearch ${expected.relationshipHint} matches were found.`
    };
  }

  return {
    status: 'missing',
    note: `No FamilySearch ${expected.relationshipHint} matched by name or birth year.`
  };
}

function getCandidateRelationships(
  expected: ExpectedGedcomRelative,
  relationships: FamilySearchCapturedRelationship[],
  matchedPageFamilySearchIds: Set<string>,
  seenFamilySearchIds: Set<string>
): FamilySearchCapturedRelationship[] {
  return getRelationshipKindCandidates(expected, relationships).filter((relationship) => (
    !matchedPageFamilySearchIds.has(relationship.personId) &&
    !seenFamilySearchIds.has(relationship.personId)
  ));
}

function getRelationshipKindCandidates(
  expected: ExpectedGedcomRelative,
  relationships: FamilySearchCapturedRelationship[]
): FamilySearchCapturedRelationship[] {
  return relationships.filter((relationship) => (
    relationship.personId &&
    relationshipMatchesExpectedKind(expected, relationship)
  ));
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

function birthYearsMatch(gedcomBirthYear: string, relationshipContext: string): boolean {
  const gedcomYear = Number(extractYear(gedcomBirthYear));
  const relationshipYear = Number(extractRelationshipBirthYear(relationshipContext));
  return Boolean(gedcomYear && relationshipYear && Math.abs(gedcomYear - relationshipYear) <= 1);
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

function exactNamesMatch(firstName: string, secondName: string): boolean {
  const firstTokens = normalizeNameTokens(firstName);
  const secondTokens = normalizeNameTokens(secondName);
  return firstTokens.length > 0 &&
    firstTokens.length === secondTokens.length &&
    firstTokens.every((token, index) => token === secondTokens[index]);
}

function namesShareComparableToken(
  firstName: string,
  secondName: string,
  commonNameTokens: Set<string>
): boolean {
  const firstTokens = new Set(normalizeNameTokens(firstName).filter((token) => !commonNameTokens.has(token)));
  return normalizeNameTokens(secondName).some((token) => (
    !commonNameTokens.has(token) &&
    firstTokens.has(token)
  ));
}

function findMostCommonNameTokens(names: string[]): Set<string> {
  const tokenCounts = new Map<string, number>();

  for (const name of names) {
    for (const token of new Set(normalizeNameTokens(name))) {
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }
  }

  const highestCount = Math.max(0, ...tokenCounts.values());
  if (highestCount <= 1) return new Set();

  return new Set(
    [...tokenCounts.entries()]
      .filter(([, count]) => count === highestCount)
      .map(([token]) => token)
  );
}

function normalizeNameTokens(value: string): string[] {
  return String(value ?? '')
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z]/g, '').toLowerCase())
    .filter(Boolean);
}

function getBirthYear(person: NormalizedGedcomPerson | undefined): string {
  return extractYear(findFact(person, 'BIRT')?.date ?? '');
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
