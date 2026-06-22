import type {
  CardSettings
} from '../../Interfaces/card-settings.interface';
import type {
  NormalizedGedcomDocument,
  NormalizedGedcomFact,
  NormalizedGedcomPerson
} from '../../Interfaces/gedcom.interface';
import type {
  CardSectionOverrides,
  CardSections,
  FactView,
  PersonCard,
  RelatedPersonView
} from '../../Interfaces/person-card.interface';

const CORE_FACTS = new Set(['BIRT', 'DEAT', 'CHR', 'BURI']);
const FACT_LABELS: Record<string, string> = {
  BIRT: 'Birth',
  DEAT: 'Death',
  CHR: 'Christening',
  BURI: 'Burial',
  RESI: 'Residence',
  CENS: 'Census',
  OCCU: 'Occupation',
  IMMI: 'Immigration',
  EMIG: 'Emigration',
  NATU: 'Naturalization',
  EVEN: 'Event'
};

export function buildGedcomPersonCards(
  document: NormalizedGedcomDocument,
  settings: CardSettings,
  sectionOverrides: CardSectionOverrides
): PersonCard[] {
  const personById = new Map(document.people.map((person) => [person.id, person]));

  return document.people.map((person) => {
    const defaultSections: CardSections = {
      parentsOpen: settings.relationshipsOpen,
      childrenOpen: settings.relationshipsOpen,
      siblingsOpen: settings.relationshipsOpen,
      residencesOpen: settings.residencesOpen,
      otherOpen: settings.otherOpen
    };

    return {
      id: person.id,
      name: getPrimaryName(person),
      gender: formatGender(person.sex),
      alternateNames: person.names.slice(1).map(formatName).filter(Boolean),
      birth: toFactView(findFact(person, 'BIRT')),
      death: toFactView(findFact(person, 'DEAT')),
      christening: toFactView(findFact(person, 'CHR')),
      burial: toFactView(findFact(person, 'BURI')),
      parents: resolveRelatedPeople(person.relationships.parents, personById),
      spouses: resolveRelatedPeople(person.relationships.spouses, personById),
      children: resolveRelatedPeople(person.relationships.children, personById),
      siblings: resolveRelatedPeople(person.relationships.siblings, personById),
      residences: person.facts.filter((fact) => fact.type === 'RESI').map(toRequiredFactView),
      otherFacts: person.facts
        .filter((fact) => !CORE_FACTS.has(fact.type) && fact.type !== 'RESI')
        .map(toRequiredFactView),
      sections: {
        ...defaultSections,
        ...sectionOverrides[person.id]
      }
    };
  });
}

function findFact(person: NormalizedGedcomPerson, type: string): NormalizedGedcomFact | undefined {
  return person.facts.find((fact) => fact.type === type);
}

function resolveRelatedPeople(
  ids: string[],
  personById: Map<string, NormalizedGedcomPerson>
): RelatedPersonView[] {
  return ids.map((id) => {
    const person = personById.get(id);
    return {
      id,
      name: person ? getPrimaryName(person) : id
    };
  });
}

function getPrimaryName(person: NormalizedGedcomPerson): string {
  return formatName(person.names[0]) || person.id;
}

function formatName(name: NormalizedGedcomPerson['names'][number] | undefined): string {
  if (!name) return '';
  if (name.given || name.surname) return [name.given, name.surname].filter(Boolean).join(' ');
  return name.full;
}

function formatGender(value: string | undefined): string {
  const normalized = value?.toUpperCase();
  if (normalized === 'M') return 'Male';
  if (normalized === 'F') return 'Female';
  return value || 'Not listed';
}

function toFactView(fact: NormalizedGedcomFact | undefined): FactView | undefined {
  return fact ? toRequiredFactView(fact) : undefined;
}

function toRequiredFactView(fact: NormalizedGedcomFact): FactView {
  return {
    type: fact.type,
    label: FACT_LABELS[fact.type] ?? titleCase(fact.type),
    date: fact.date,
    place: fact.place,
    value: fact.value,
    notes: fact.notes
  };
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|_|\s)\w/g, (letter) => letter.toUpperCase());
}
