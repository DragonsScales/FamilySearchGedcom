import type {
  FamilySearchCapturedRelationship
} from './Interfaces/familysearch-person.interface';
import type {
  NormalizedGedcomDocument,
  NormalizedGedcomPerson
} from './Interfaces/gedcom.interface';
import {
  buildGedcomTraversalRoute
} from './gedcom-guided-traversal';

describe('buildGedcomTraversalRoute', () => {
  it('matches GEDCOM relatives in father, mother, spouse, child order', () => {
    const document = buildDocument();
    const route = buildGedcomTraversalRoute({
      document,
      currentGedcomPersonId: 'ROOT',
      currentBranch: 'root',
      relationships: [
        relationship('FS-MOTHER', 'Mary Root', 'mother', 'Mary Root | Female | 1902-1980 | FS-MOTHER'),
        relationship('FS-FATHER', 'John Root', 'father', 'John Root | Male | 1900-1980 | FS-FATHER'),
        relationship('FS-CHILD', 'Sam Root', 'son', 'Sam Root | Male | 1950-Living | FS-CHILD'),
        relationship('FS-SPOUSE', 'Jane Root', 'wife', 'Jane Root | Female | 1930-Living | FS-SPOUSE')
      ],
      seenGedcomPersonIds: ['ROOT'],
      seenFamilySearchIds: ['FS-ROOT']
    });

    expect(route.matches.map((match) => match.gedcomPersonId)).toEqual([
      'FATHER',
      'MOTHER',
      'SPOUSE',
      'CHILD'
    ]);
    expect(route.matches.map((match) => match.branch)).toEqual([
      'ancestor',
      'ancestor',
      'descendant',
      'descendant'
    ]);
    expect(route.unmatched).toEqual([]);
  });

  it('skips parent expansion after a descendant branch reaches a child', () => {
    const document = buildDocument();
    const route = buildGedcomTraversalRoute({
      document,
      currentGedcomPersonId: 'CHILD',
      currentBranch: 'descendant',
      relationships: [
        relationship('FS-ROOT', 'Robert Root', 'father', 'Robert Root | Male | 1930-Living | FS-ROOT'),
        relationship('FS-SPOUSE', 'Alex Child', 'spouse', 'Alex Child | Female | 1972-Living | FS-SPOUSE')
      ],
      seenGedcomPersonIds: ['CHILD'],
      seenFamilySearchIds: ['FS-CHILD']
    });

    expect(route.matches.map((match) => match.gedcomPersonId)).toEqual(['CHILD-SPOUSE']);
  });

  it('leaves an ambiguous child unmatched when name and birth year cannot choose one', () => {
    const document = buildDocument();
    const route = buildGedcomTraversalRoute({
      document,
      currentGedcomPersonId: 'ROOT',
      currentBranch: 'root',
      relationships: [
        relationship('FS-SAM-1', 'Sam Root', 'son', 'Sam Root | Male | 1950-Living | FS-SAM-1'),
        relationship('FS-SAM-2', 'Sam Root', 'son', 'Sam Root | Male | 1950-Living | FS-SAM-2')
      ],
      seenGedcomPersonIds: ['ROOT', 'FATHER', 'MOTHER', 'SPOUSE'],
      seenFamilySearchIds: ['FS-ROOT']
    });

    expect(route.matches).toEqual([]);
    expect(route.unmatched).toEqual([
      {
        status: 'ambiguous',
        gedcomPersonId: 'CHILD',
        name: 'Sam Root',
        relationshipHint: 'child',
        branch: 'descendant',
        matchNote: 'Multiple FamilySearch child matches were found.'
      }
    ]);
  });

  it('matches by birth year when exact birth dates differ', () => {
    const document = buildDocument();
    document.people[4] = person('CHILD', 'Sam Root', 'M', '10 JAN 1950', ['F-ROOT'], ['F-CHILD']);

    const route = buildGedcomTraversalRoute({
      document,
      currentGedcomPersonId: 'ROOT',
      currentBranch: 'root',
      relationships: [
        relationship('FS-SAM-1', 'Sam Root', 'son', 'Sam Root | Male | 12 FEB 1950-Living | FS-SAM-1'),
        relationship('FS-SAM-2', 'Sam Root', 'son', 'Sam Root | Male | 1952-Living | FS-SAM-2')
      ],
      seenGedcomPersonIds: ['ROOT', 'FATHER', 'MOTHER', 'SPOUSE'],
      seenFamilySearchIds: ['FS-ROOT']
    });

    expect(route.matches.map((match) => ({
      gedcomPersonId: match.gedcomPersonId,
      familySearchId: match.familySearchId,
      matchNote: match.matchNote
    }))).toEqual([
      {
        gedcomPersonId: 'CHILD',
        familySearchId: 'FS-SAM-1',
        matchNote: 'Matched by birth year range.'
      }
    ]);
    expect(route.unmatched).toEqual([]);
  });

  it('matches child names before using birth year range fallbacks', () => {
    const document = buildDocument();
    document.people[4] = person('CHILD', 'Gertrude Alice Wilson', 'F', '10 DEC 1893', ['F-ROOT'], []);
    document.people.push(person('CHILD-2', 'Ralph Arnold Wilson', 'M', '1895', ['F-ROOT'], []));
    document.families[1] = {
      ...document.families[1],
      childIds: ['CHILD', 'CHILD-2']
    };

    const route = buildGedcomTraversalRoute({
      document,
      currentGedcomPersonId: 'ROOT',
      currentBranch: 'root',
      relationships: [
        relationship('FS-RALPH', 'Ralph Arnold Wilson', 'son', 'Ralph Arnold Wilson | Male | 1894-Living | FS-RALPH'),
        relationship('FS-GERTRUDE', 'Alice Gertrude Wilson', 'daughter', 'Alice Gertrude Wilson | Female | 1894-Living | FS-GERTRUDE')
      ],
      seenGedcomPersonIds: ['ROOT', 'FATHER', 'MOTHER', 'SPOUSE'],
      seenFamilySearchIds: ['FS-ROOT']
    });

    expect(route.matches.map((match) => ({
      gedcomPersonId: match.gedcomPersonId,
      familySearchId: match.familySearchId,
      matchNote: match.matchNote
    }))).toEqual([
      {
        gedcomPersonId: 'CHILD',
        familySearchId: 'FS-GERTRUDE',
        matchNote: 'Matched by name token.'
      },
      {
        gedcomPersonId: 'CHILD-2',
        familySearchId: 'FS-RALPH',
        matchNote: 'Matched by full name.'
      }
    ]);
    expect(route.unmatched).toEqual([]);
  });

  it('uses the full child family context when matching the last unattached child by name token', () => {
    const document = buildDocument();
    document.people[4] = person('CHILD', 'Gertrude Alice Wilson', 'F', '10 DEC 1893', ['F-ROOT'], []);
    document.people.push(person('CHILD-2', 'Ralph Arnold Wilson', 'M', '1895', ['F-ROOT'], []));
    document.families[1] = {
      ...document.families[1],
      childIds: ['CHILD', 'CHILD-2']
    };

    const route = buildGedcomTraversalRoute({
      document,
      currentGedcomPersonId: 'ROOT',
      currentBranch: 'root',
      relationships: [
        relationship('FS-GERTRUDE', 'Alice Gertrude Wilson', 'daughter', 'Alice Gertrude Wilson | Female | FS-GERTRUDE')
      ],
      seenGedcomPersonIds: ['ROOT', 'FATHER', 'MOTHER', 'SPOUSE', 'CHILD-2'],
      seenFamilySearchIds: ['FS-ROOT', 'FS-RALPH']
    });

    expect(route.matches.map((match) => ({
      gedcomPersonId: match.gedcomPersonId,
      familySearchId: match.familySearchId,
      matchNote: match.matchNote
    }))).toEqual([
      {
        gedcomPersonId: 'CHILD',
        familySearchId: 'FS-GERTRUDE',
        matchNote: 'Matched by name token.'
      }
    ]);
    expect(route.unmatched).toEqual([]);
  });

  it('ignores already attached FamilySearch children during child matching', () => {
    const document = buildDocument();
    const route = buildGedcomTraversalRoute({
      document,
      currentGedcomPersonId: 'ROOT',
      currentBranch: 'root',
      relationships: [
        relationship('FS-SEEN-CHILD', 'Sam Root', 'son', 'Sam Root | Male | 1950-Living | FS-SEEN-CHILD'),
        relationship('FS-CHILD', 'Sam Root', 'son', 'Sam Root | Male | 1950-Living | FS-CHILD')
      ],
      seenGedcomPersonIds: ['ROOT', 'FATHER', 'MOTHER', 'SPOUSE'],
      seenFamilySearchIds: ['FS-ROOT', 'FS-SEEN-CHILD']
    });

    expect(route.matches.map((match) => ({
      gedcomPersonId: match.gedcomPersonId,
      familySearchId: match.familySearchId,
      matchNote: match.matchNote
    }))).toEqual([
      {
        gedcomPersonId: 'CHILD',
        familySearchId: 'FS-CHILD',
        matchNote: 'Matched by full name.'
      }
    ]);
    expect(route.unmatched).toEqual([]);
  });

  it('leaves birth year range matches ambiguous when multiple remaining children could match', () => {
    const document = buildDocument();
    document.people[4] = person('CHILD', 'Gertrude Alice Wilson', 'F', '10 DEC 1893', ['F-ROOT'], []);
    document.people.push(person('CHILD-2', 'Ralph Arnold Wilson', 'M', '1895', ['F-ROOT'], []));
    document.families[1] = {
      ...document.families[1],
      childIds: ['CHILD', 'CHILD-2']
    };

    const route = buildGedcomTraversalRoute({
      document,
      currentGedcomPersonId: 'ROOT',
      currentBranch: 'root',
      relationships: [
        relationship('FS-UNKNOWN', 'Unknown Wilson', 'child', 'Unknown Wilson | Unknown | 1894-Living | FS-UNKNOWN')
      ],
      seenGedcomPersonIds: ['ROOT', 'FATHER', 'MOTHER', 'SPOUSE'],
      seenFamilySearchIds: ['FS-ROOT']
    });

    expect(route.matches).toEqual([]);
    expect(route.unmatched).toEqual([
      {
        status: 'ambiguous',
        gedcomPersonId: 'CHILD',
        name: 'Gertrude Alice Wilson',
        relationshipHint: 'child',
        branch: 'descendant',
        matchNote: 'Multiple FamilySearch child matches were found.'
      },
      {
        status: 'ambiguous',
        gedcomPersonId: 'CHILD-2',
        name: 'Ralph Arnold Wilson',
        relationshipHint: 'child',
        branch: 'descendant',
        matchNote: 'Multiple FamilySearch child matches were found.'
      }
    ]);
  });

  it('does not match children by surname alone when multiple candidates remain', () => {
    const document = buildDocument();
    const route = buildGedcomTraversalRoute({
      document,
      currentGedcomPersonId: 'ROOT',
      currentBranch: 'root',
      relationships: [
        relationship('FS-ALEX', 'Alex Root', 'son', 'Alex Root | Male | 1952-Living | FS-ALEX'),
        relationship('FS-JORDAN', 'Jordan Root', 'son', 'Jordan Root | Male | 1953-Living | FS-JORDAN')
      ],
      seenGedcomPersonIds: ['ROOT', 'FATHER', 'MOTHER', 'SPOUSE'],
      seenFamilySearchIds: ['FS-ROOT']
    });

    expect(route.matches).toEqual([]);
    expect(route.unmatched).toEqual([
      {
        status: 'missing',
        gedcomPersonId: 'CHILD',
        name: 'Sam Root',
        relationshipHint: 'child',
        branch: 'descendant',
        matchNote: 'No FamilySearch child matched by name or birth year.'
      }
    ]);
  });

  it('matches same-role parents by name instead of dropping the second parent', () => {
    const document = buildDocument();
    document.people.push(person('SECOND-FATHER', 'Paul Root', 'M', '1904', [], ['F-SAME-ROLE']));
    document.people[0] = {
      ...document.people[0],
      parentFamilyIds: ['F-SAME-ROLE']
    };
    document.families.push({
      id: 'F-SAME-ROLE',
      husbandId: 'FATHER',
      husbandIds: ['FATHER', 'SECOND-FATHER'],
      childIds: ['ROOT'],
      facts: []
    });

    const route = buildGedcomTraversalRoute({
      document,
      currentGedcomPersonId: 'ROOT',
      currentBranch: 'root',
      relationships: [
        relationship('FS-FATHER', 'John Root', 'father', 'John Root | Male | 1900-1980 | FS-FATHER'),
        relationship('FS-SECOND-FATHER', 'Paul Root', 'father', 'Paul Root | Male | 1904-1980 | FS-SECOND-FATHER')
      ],
      seenGedcomPersonIds: ['ROOT', 'MOTHER', 'SPOUSE', 'CHILD'],
      seenFamilySearchIds: ['FS-ROOT']
    });

    expect(route.matches.map((match) => match.gedcomPersonId)).toEqual([
      'FATHER',
      'SECOND-FATHER'
    ]);
  });
});

function buildDocument(): NormalizedGedcomDocument {
  return {
    metadata: {
      importedAt: '2026-06-18T00:00:00.000Z'
    },
    people: [
      person('ROOT', 'Robert Root', 'M', '1930', ['F-PARENTS'], ['F-ROOT']),
      person('FATHER', 'John Root', 'M', '1900', [], ['F-PARENTS']),
      person('MOTHER', 'Mary Root', 'F', '1902', [], ['F-PARENTS']),
      person('SPOUSE', 'Jane Root', 'F', '1930', [], ['F-ROOT']),
      person('CHILD', 'Sam Root', 'M', '1950', ['F-ROOT'], ['F-CHILD']),
      person('CHILD-SPOUSE', 'Alex Child', 'F', '1972', [], ['F-CHILD'])
    ],
    families: [
      {
        id: 'F-PARENTS',
        husbandId: 'FATHER',
        wifeId: 'MOTHER',
        childIds: ['ROOT'],
        facts: []
      },
      {
        id: 'F-ROOT',
        husbandId: 'ROOT',
        wifeId: 'SPOUSE',
        childIds: ['CHILD'],
        facts: []
      },
      {
        id: 'F-CHILD',
        husbandId: 'CHILD',
        wifeId: 'CHILD-SPOUSE',
        childIds: [],
        facts: []
      }
    ]
  };
}

function person(
  id: string,
  name: string,
  sex: string,
  birthDate: string,
  parentFamilyIds: string[],
  spouseFamilyIds: string[]
): NormalizedGedcomPerson {
  return {
    id,
    names: [{ full: name }],
    sex,
    facts: [{ type: 'BIRT', date: birthDate, notes: [] }],
    parentFamilyIds,
    spouseFamilyIds,
    relationships: {
      parents: [],
      spouses: [],
      children: [],
      siblings: []
    }
  };
}

function relationship(
  personId: string,
  name: string,
  relationshipHint: string,
  context: string
): FamilySearchCapturedRelationship {
  return {
    personId,
    name,
    relationshipHint,
    url: `https://www.familysearch.org/en/tree/person/details/${personId}`,
    context
  };
}
