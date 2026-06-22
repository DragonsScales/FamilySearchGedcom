import type {
  GedcomDocument,
  GedcomFact,
  GedcomFamily,
  GedcomName,
  GedcomNode,
  GedcomPerson,
  GedcomPersonRelationships
} from './types.js';

const PERSON_FACT_TAGS = new Set([
  'ADOP',
  'BAPM',
  'BARM',
  'BASM',
  'BIRT',
  'BLES',
  'BURI',
  'CENS',
  'CHR',
  'CHRA',
  'CONF',
  'CREM',
  'DEAT',
  'DSCR',
  'EDUC',
  'EMIG',
  'EVEN',
  'GRAD',
  'IMMI',
  'NATI',
  'NATU',
  'OCCU',
  'ORDN',
  'PROB',
  'RELI',
  'RESI',
  'RETI',
  'WILL'
]);

const FAMILY_FACT_TAGS = new Set([
  'ANUL',
  'CENS',
  'DIV',
  'DIVF',
  'ENGA',
  'EVEN',
  'MARB',
  'MARC',
  'MARR',
  'MARL',
  'MARS',
  'RESI'
]);

export function parseGedcom(text: string): GedcomDocument {
  const roots = parseGedcomNodes(text);
  const families = roots
    .filter((node) => node.tag === 'FAM' && node.pointer)
    .map(parseFamily);
  const people = roots
    .filter((node) => node.tag === 'INDI' && node.pointer)
    .map(parsePerson);

  const peopleWithRelationships = hydrateRelationships(people, families);

  return {
    metadata: parseMetadata(roots),
    people: peopleWithRelationships,
    families
  };
}

export function parseGedcomNodes(text: string): GedcomNode[] {
  const roots: GedcomNode[] = [];
  const stack: GedcomNode[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const node = parseLine(rawLine);

    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);

    stack.push(node);
  }

  return roots;
}

function parseLine(line: string): GedcomNode {
  const match = line.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?([A-Za-z0-9_]+)(?:\s+(.*))?$/);
  if (!match) {
    throw new Error(`Invalid GEDCOM line: ${line}`);
  }

  return {
    level: Number(match[1]),
    pointer: match[2],
    tag: match[3],
    value: match[4],
    children: []
  };
}

function parseMetadata(roots: GedcomNode[]): GedcomDocument['metadata'] {
  const head = roots.find((node) => node.tag === 'HEAD');
  const gedc = head?.children.find((node) => node.tag === 'GEDC');

  return {
    source: head?.children.find((node) => node.tag === 'SOUR')?.value,
    version: gedc?.children.find((node) => node.tag === 'VERS')?.value,
    charset: head?.children.find((node) => node.tag === 'CHAR')?.value,
    importedAt: new Date().toISOString()
  };
}

function parsePerson(node: GedcomNode): GedcomPerson {
  const names = node.children
    .filter((child) => child.tag === 'NAME')
    .map(parseName);

  const facts = node.children
    .filter((child) => PERSON_FACT_TAGS.has(child.tag))
    .map(parseFact);

  const parentFamilyIds = node.children
    .filter((child) => child.tag === 'FAMC' && child.value)
    .map((child) => normalizePointer(child.value));

  const spouseFamilyIds = node.children
    .filter((child) => child.tag === 'FAMS' && child.value)
    .map((child) => normalizePointer(child.value));

  return {
    id: normalizePointer(node.pointer),
    names,
    sex: node.children.find((child) => child.tag === 'SEX')?.value,
    facts,
    parentFamilyIds,
    spouseFamilyIds,
    relationships: emptyRelationships()
  };
}

function parseFamily(node: GedcomNode): GedcomFamily {
  const husbandIds = node.children
    .filter((child) => child.tag === 'HUSB' && child.value)
    .map((child) => normalizePointer(child.value));
  const wifeIds = node.children
    .filter((child) => child.tag === 'WIFE' && child.value)
    .map((child) => normalizePointer(child.value));

  return {
    id: normalizePointer(node.pointer),
    husbandId: husbandIds[0],
    wifeId: wifeIds[0],
    husbandIds,
    wifeIds,
    childIds: node.children
      .filter((child) => child.tag === 'CHIL' && child.value)
      .map((child) => normalizePointer(child.value)),
    facts: node.children
      .filter((child) => FAMILY_FACT_TAGS.has(child.tag))
      .map(parseFact)
  };
}

function parseName(node: GedcomNode): GedcomName {
  const full = node.value ?? '';
  return {
    full: full.replaceAll('/', '').replace(/\s+/g, ' ').trim(),
    given: node.children.find((child) => child.tag === 'GIVN')?.value,
    surname: node.children.find((child) => child.tag === 'SURN')?.value
  };
}

function parseFact(node: GedcomNode): GedcomFact {
  return {
    type: node.tag,
    value: node.value,
    date: node.children.find((child) => child.tag === 'DATE')?.value,
    place: node.children.find((child) => child.tag === 'PLAC')?.value,
    notes: node.children
      .filter((child) => child.tag === 'NOTE')
      .map((child) => joinContinuationText(child))
  };
}

function joinContinuationText(node: GedcomNode): string {
  const lines = [node.value ?? ''];
  for (const child of node.children) {
    if (child.tag === 'CONT') lines.push(child.value ?? '');
    if (child.tag === 'CONC') lines[lines.length - 1] += child.value ?? '';
  }
  return lines.join('\n').trim();
}

function hydrateRelationships(people: GedcomPerson[], families: GedcomFamily[]): GedcomPerson[] {
  const familyById = new Map(families.map((family) => [family.id, family]));

  return people.map((person) => ({
    ...person,
    relationships: buildRelationships(person, familyById)
  }));
}

function buildRelationships(
  person: GedcomPerson,
  familyById: Map<string, GedcomFamily>
): GedcomPersonRelationships {
  const parents = new Set<string>();
  const spouses = new Set<string>();
  const children = new Set<string>();
  const siblings = new Set<string>();

  for (const familyId of person.parentFamilyIds) {
    const family = familyById.get(familyId);
    if (!family) continue;

    for (const parentId of getFamilySpouseIds(family)) parents.add(parentId);
    for (const childId of family.childIds) {
      if (childId !== person.id) siblings.add(childId);
    }
  }

  for (const familyId of person.spouseFamilyIds) {
    const family = familyById.get(familyId);
    if (!family) continue;

    for (const spouseId of getFamilySpouseIds(family)) {
      if (spouseId !== person.id) spouses.add(spouseId);
    }
    for (const childId of family.childIds) children.add(childId);
  }

  return {
    parents: [...parents],
    spouses: [...spouses],
    children: [...children],
    siblings: [...siblings]
  };
}

function getFamilySpouseIds(family: GedcomFamily): string[] {
  return [
    ...(family.husbandIds ?? [family.husbandId].filter((id): id is string => Boolean(id))),
    ...(family.wifeIds ?? [family.wifeId].filter((id): id is string => Boolean(id)))
  ];
}

function emptyRelationships(): GedcomPersonRelationships {
  return {
    parents: [],
    spouses: [],
    children: [],
    siblings: []
  };
}

function normalizePointer(value?: string): string {
  return value?.replace(/^@|@$/g, '') ?? '';
}
