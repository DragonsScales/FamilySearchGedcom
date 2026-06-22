import type {
  CardSettings
} from '../../Interfaces/card-settings.interface';
import type {
  FamilySearchCaptureRecord
} from '../../Interfaces/familysearch-collector.interface';
import type {
  FamilySearchCapturedFact,
  FamilySearchCapturedRelationship,
  FamilySearchRetrievedPerson
} from '../../Interfaces/familysearch-person.interface';
import type {
  CardSectionOverrides,
  CardSections,
  FactView,
  PersonCard,
  RelatedPersonView
} from '../../Interfaces/person-card.interface';
import { buildFamilySearchPersonDetailsUrl } from '../../familysearch-person-url';
import {
  findUsableFamilySearchPersonName
} from '../../familysearch-person-name';

const DEFAULT_CARD_SETTINGS: CardSettings = {
  relationshipsOpen: false,
  residencesOpen: false,
  otherOpen: false
};

export function buildFamilySearchPersonCard(
  person: FamilySearchRetrievedPerson,
  settings: CardSettings = DEFAULT_CARD_SETTINGS,
  sectionOverrides: CardSectionOverrides = {}
): PersonCard {
  const factViews = person.facts.map(toFactView);
  const sex = findFactView(factViews, 'Sex');
  const sections = buildSections(settings, sectionOverrides[person.familySearchId]);
  const name = findUsableFamilySearchPersonName([
    findCapturedFactValue(person.facts, 'Name', 'Value'),
    person.displayName,
    cleanTitleName(person.title)
  ]) || person.familySearchId;

  return {
    id: person.familySearchId,
    referenceLabel: 'FamilySearch ID',
    referenceId: person.familySearchId,
    referenceUrl: buildFamilySearchPersonDetailsUrl(person.familySearchId),
    name,
    gender: formatGenderValue(sex?.value),
    alternateNames: [],
    birth: findFactView(factViews, 'Birth'),
    death: findFactView(factViews, 'Death'),
    christening: findFactView(factViews, 'Christening'),
    burial: findFactView(factViews, 'Burial'),
    parents: toRelatedPeople(person.relationships, ['parent', 'mother', 'father']),
    children: toRelatedPeople(person.relationships, ['child', 'son', 'daughter']),
    siblings: toRelatedPeople(person.relationships, ['sibling', 'brother', 'sister']),
    residences: factViews.filter((fact) => fact.label === 'Residence'),
    otherFacts: factViews.filter((fact) => ![
      'Name',
      'Sex',
      'Birth',
      'Death',
      'Christening',
      'Burial',
      'Residence'
    ].includes(fact.label)),
    sections
  };
}

function findCapturedFactValue(
  facts: FamilySearchCapturedFact[],
  factType: string,
  valueLabel: string
): string {
  const fact = facts.find((candidate) => candidate.type.toLowerCase() === factType.toLowerCase());
  if (!fact) return '';

  const prefix = `${valueLabel}:`;
  const value = fact.values.find((candidate) => candidate.toLowerCase().startsWith(prefix.toLowerCase()));
  return value?.slice(prefix.length).trim() ?? '';
}

function formatGenderValue(value: string | undefined): string {
  return value?.replace(/^Value:\s*/i, '').trim() || 'Not listed';
}

function cleanTitleName(value: string): string {
  return value
    .replace(/\s*\|\s*FamilySearch.*$/i, '')
    .replace(/\s*\u2022\s*Person\s*\u2022\s*Family Tree.*$/i, '')
    .replace(/\s*\([^)]*\)\s*$/i, '')
    .trim();
}

export function buildFamilySearchPersonCards(
  records: FamilySearchCaptureRecord[],
  settings: CardSettings,
  sectionOverrides: CardSectionOverrides
): PersonCard[] {
  return records
    .map(toRetrievedPerson)
    .filter((person): person is FamilySearchRetrievedPerson => person !== null)
    .map((person) => buildFamilySearchPersonCard(person, settings, sectionOverrides));
}

function toRetrievedPerson(record: FamilySearchCaptureRecord): FamilySearchRetrievedPerson | null {
  const familySearchId = record.person?.familySearchId ?? '';
  if (!familySearchId) return null;

  return {
    familySearchId,
    displayName: record.person?.displayName || familySearchId,
    url: record.url ?? '',
    title: record.title ?? '',
    capturedAt: record.capturedAt ?? '',
    facts: record.facts ?? [],
    relationships: record.relationships ?? [],
    debugSnapshot: record.raw
  };
}

function buildSections(
  settings: CardSettings,
  overrides: Partial<CardSections> = {}
): CardSections {
  return {
    parentsOpen: settings.relationshipsOpen,
    childrenOpen: settings.relationshipsOpen,
    siblingsOpen: settings.relationshipsOpen,
    residencesOpen: settings.residencesOpen,
    otherOpen: settings.otherOpen,
    ...overrides
  };
}

function toFactView(fact: FamilySearchCapturedFact): FactView {
  return {
    type: fact.type,
    label: fact.type,
    date: findFactValue(fact.values, 'Date'),
    place: findFactValue(fact.values, 'Place'),
    value: fact.values.join(' | ') || fact.rawText,
    notes: fact.rawText ? [fact.rawText] : []
  };
}

function findFactView(facts: FactView[], label: string): FactView | undefined {
  return facts.find((fact) => fact.label === label);
}

function findFactValue(values: string[], label: string): string | undefined {
  const prefix = `${label}:`;
  const match = values.find((value) => value.toLowerCase().startsWith(prefix.toLowerCase()));
  return match?.slice(prefix.length).trim() || undefined;
}

function toRelatedPeople(
  relationships: FamilySearchCapturedRelationship[],
  relationshipTerms: string[]
): RelatedPersonView[] {
  return relationships
    .filter((relationship) => hasRelationshipTerm(relationship.relationshipHint, relationshipTerms))
    .map((relationship) => ({
      id: relationship.personId,
      name: relationship.name || relationship.personId
    }));
}

function hasRelationshipTerm(value: string, relationshipTerms: string[]): boolean {
  const normalized = value.toLowerCase();
  return relationshipTerms.some((term) => normalized.includes(term));
}
