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

  it('leaves an ambiguous child unmatched when first name and birth year cannot choose one', () => {
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

  it('matches same-role parents by first name instead of dropping the second parent', () => {
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
