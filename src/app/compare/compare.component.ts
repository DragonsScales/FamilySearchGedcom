import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  FamilySearchCollectorState,
  FamilySearchTraversalMetadata
} from '../../Interfaces/familysearch-collector.interface';
import type {
  NormalizedGedcomDocument,
  NormalizedGedcomFact
} from '../../Interfaces/gedcom.interface';
import type {
  FactView,
  PersonCard,
  RelatedPersonView
} from '../../Interfaces/person-card.interface';
import type { StoredGedcomImport } from '../../Interfaces/storage.interface';
import { ExtensionStorageService } from '../extension-storage.service';
import { FamilySearchTraversalService } from '../familysearch-traversal.service';
import { buildFamilySearchPersonCards } from '../person-card/familysearch-person-card.mapper';
import { buildGedcomPersonCards } from '../person-card/gedcom-person-card.mapper';

interface ComparisonField {
  label: string;
  gedcomValue: string;
  familySearchValue: string;
  gedcomPreview: string;
  familySearchPreview: string;
  preferredPreview: string;
  isCollapsible: boolean;
  defaultOpen: boolean;
  preferred: PreferredValue;
}

interface ComparisonPersonRow {
  id: string;
  title: string;
  gedcomReference: string;
  familySearchReference: string;
  matchStatus: string;
  matchNote: string;
  fields: ComparisonField[];
}

interface PreferredValue {
  source: 'same' | 'new' | 'review' | 'empty';
  label: string;
  value: string;
}

interface ComparisonFieldInput {
  label: string;
  gedcomValue: string;
  familySearchValue: string;
}

const DEFAULT_CARD_SETTINGS = {
  relationshipsOpen: false,
  residencesOpen: false,
  otherOpen: false
};
const EMPTY_VALUE = 'Not listed';

@Component({
  selector: 'fsg-compare',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './compare.component.html',
  styleUrl: './compare.component.css'
})
export class CompareComponent implements OnInit, OnDestroy {
  private readonly storage = inject(ExtensionStorageService);
  private readonly traversal = inject(FamilySearchTraversalService);
  private unsubscribeGedcomImport: (() => void) | null = null;
  private unsubscribeCollectorState: (() => void) | null = null;

  readonly importedGedcom = signal<StoredGedcomImport | null>(null);
  readonly collectorState = signal<FamilySearchCollectorState | null>(null);
  readonly loadErrorMessage = signal('');
  readonly isLoading = signal(false);

  readonly comparisonRows = computed(() => buildComparisonRows(
    this.importedGedcom(),
    this.collectorState()
  ));
  readonly capturedCount = computed(() => this.collectorState()?.records.length ?? 0);

  async ngOnInit(): Promise<void> {
    this.watchComparisonContext();
    await this.loadComparisonContext();
  }

  ngOnDestroy(): void {
    this.unsubscribeGedcomImport?.();
    this.unsubscribeCollectorState?.();
  }

  async loadComparisonContext(): Promise<void> {
    this.isLoading.set(true);
    this.loadErrorMessage.set('');

    try {
      const [importedGedcom, collectorState] = await Promise.all([
        this.storage.getGedcomImport(),
        this.traversal.getState()
      ]);
      this.importedGedcom.set(importedGedcom);
      this.collectorState.set(collectorState);
    } catch (error) {
      this.loadErrorMessage.set(error instanceof Error ? error.message : 'Could not load comparison data.');
      this.importedGedcom.set(null);
      this.collectorState.set(null);
    } finally {
      this.isLoading.set(false);
    }
  }

  private watchComparisonContext(): void {
    this.unsubscribeGedcomImport = this.storage.watchGedcomImport((importedGedcom) => {
      this.importedGedcom.set(importedGedcom);
      this.loadErrorMessage.set('');
    });

    this.unsubscribeCollectorState = this.traversal.watchState((collectorState) => {
      this.collectorState.set(collectorState);
      this.loadErrorMessage.set('');
    });
  }
}

function buildComparisonRows(
  importedGedcom: StoredGedcomImport | null,
  collectorState: FamilySearchCollectorState | null
): ComparisonPersonRow[] {
  if (!importedGedcom || !collectorState) return [];

  const gedcomCards = buildGedcomPersonCards(importedGedcom.document, DEFAULT_CARD_SETTINGS, {});
  const gedcomById = new Map(gedcomCards.map((card) => [card.id, card]));
  const familySearchByGedcomId = new Map<string, PersonCard>();
  const traversalByGedcomId = new Map<string, FamilySearchTraversalMetadata>();
  const rowIds: string[] = [];

  for (const record of collectorState.records) {
    const gedcomPersonId = record.traversal?.gedcomPersonId ?? '';
    if (!gedcomPersonId) continue;

    if (!rowIds.includes(gedcomPersonId)) rowIds.push(gedcomPersonId);
    if (record.traversal) traversalByGedcomId.set(gedcomPersonId, record.traversal);

    const [familySearchCard] = buildFamilySearchPersonCards([record], DEFAULT_CARD_SETTINGS, {});
    if (familySearchCard) familySearchByGedcomId.set(gedcomPersonId, familySearchCard);
  }

  return rowIds.map((gedcomPersonId) => {
    const gedcomCard = gedcomById.get(gedcomPersonId) ?? null;
    const familySearchCard = familySearchByGedcomId.get(gedcomPersonId) ?? null;
    const traversal = traversalByGedcomId.get(gedcomPersonId);

    return {
      id: gedcomPersonId,
      title: gedcomCard?.name || familySearchCard?.name || gedcomPersonId,
      gedcomReference: gedcomCard ? `GEDCOM ${gedcomCard.id}` : gedcomPersonId,
      familySearchReference: familySearchCard?.referenceId
        ? `FamilySearch ${familySearchCard.referenceId}`
        : formatMatchStatus(traversal?.matchStatus),
      matchStatus: formatMatchStatus(traversal?.matchStatus),
      matchNote: traversal?.matchNote ?? '',
      fields: buildComparisonFields(
        gedcomCard,
        familySearchCard,
        importedGedcom.document,
        gedcomPersonId
      )
    };
  });
}

function buildComparisonFields(
  gedcomCard: PersonCard | null,
  familySearchCard: PersonCard | null,
  document: NormalizedGedcomDocument,
  gedcomPersonId: string
): ComparisonField[] {
  const fieldInputs = [
    fieldInput('Name', gedcomCard?.name, familySearchCard?.name),
    fieldInput('Alt Name', formatLines(gedcomCard?.alternateNames), formatLines(familySearchCard?.alternateNames)),
    fieldInput('Gender', gedcomCard?.gender, familySearchCard?.gender),
    fieldInput('Birth Date', gedcomCard?.birth?.date, familySearchCard?.birth?.date),
    fieldInput('Birth Place', gedcomCard?.birth?.place, familySearchCard?.birth?.place),
    fieldInput('Death Date', gedcomCard?.death?.date, familySearchCard?.death?.date),
    fieldInput('Death Place', gedcomCard?.death?.place, familySearchCard?.death?.place),
    fieldInput('Christening Date', gedcomCard?.christening?.date, familySearchCard?.christening?.date),
    fieldInput('Christening Place', gedcomCard?.christening?.place, familySearchCard?.christening?.place),
    fieldInput('Burial Date', gedcomCard?.burial?.date, familySearchCard?.burial?.date),
    fieldInput('Burial Place', gedcomCard?.burial?.place, familySearchCard?.burial?.place),
    fieldInput('Parents', formatRelatedPeople(gedcomCard?.parents), formatRelatedPeople(familySearchCard?.parents)),
    fieldInput('Spouse', formatRelatedPeople(gedcomCard?.spouses), formatRelatedPeople(familySearchCard?.spouses)),
    fieldInput('Children', formatRelatedPeople(gedcomCard?.children), formatRelatedPeople(familySearchCard?.children)),
    fieldInput('Siblings', formatRelatedPeople(gedcomCard?.siblings), formatRelatedPeople(familySearchCard?.siblings)),
    fieldInput(
      'Marriage Date',
      formatGedcomMarriageFacts(document, gedcomPersonId, 'date'),
      formatFamilySearchMarriageFacts(familySearchCard?.otherFacts, 'date')
    ),
    fieldInput(
      'Marriage Place',
      formatGedcomMarriageFacts(document, gedcomPersonId, 'place'),
      formatFamilySearchMarriageFacts(familySearchCard?.otherFacts, 'place')
    ),
    fieldInput('Residences', formatFacts(gedcomCard?.residences), formatFacts(familySearchCard?.residences)),
    fieldInput('Other', formatOtherFacts(gedcomCard?.otherFacts), formatOtherFacts(familySearchCard?.otherFacts))
  ];

  return fieldInputs
    .filter((input) => hasListedValue(input.gedcomValue) || hasListedValue(input.familySearchValue))
    .map((input) => {
      const preferred = choosePreferredValue(input.gedcomValue, input.familySearchValue);
      return {
        label: input.label,
        gedcomValue: input.gedcomValue,
        familySearchValue: input.familySearchValue,
        gedcomPreview: firstLine(input.gedcomValue),
        familySearchPreview: firstLine(input.familySearchValue),
        preferredPreview: firstLine(preferred.value),
        isCollapsible: hasMultipleLines(input.gedcomValue) ||
          hasMultipleLines(input.familySearchValue) ||
          hasMultipleLines(preferred.value),
        defaultOpen: input.label !== 'Residences',
        preferred
      };
    });
}

function fieldInput(
  label: string,
  gedcomValue: string | undefined,
  familySearchValue: string | undefined
): ComparisonFieldInput {
  return {
    label,
    gedcomValue: normalizeDisplayValue(gedcomValue),
    familySearchValue: normalizeDisplayValue(familySearchValue)
  };
}

function hasListedValue(value: string): boolean {
  return value !== EMPTY_VALUE;
}

function choosePreferredValue(gedcomValue: string, familySearchValue: string): PreferredValue {
  const hasGedcom = gedcomValue !== EMPTY_VALUE;
  const hasFamilySearch = familySearchValue !== EMPTY_VALUE;

  if (!hasGedcom && !hasFamilySearch) {
    return {
      source: 'empty',
      label: 'Empty',
      value: EMPTY_VALUE
    };
  }

  if (hasGedcom && hasFamilySearch && toComparableValue(gedcomValue) === toComparableValue(familySearchValue)) {
    return {
      source: 'same',
      label: 'Same',
      value: gedcomValue
    };
  }

  if (hasGedcom && !hasFamilySearch) {
    return {
      source: 'new',
      label: 'New',
      value: gedcomValue
    };
  }

  if (!hasGedcom && hasFamilySearch) {
    return {
      source: 'new',
      label: 'New',
      value: familySearchValue
    };
  }

  return {
    source: 'review',
    label: 'Review',
    value: 'Needs review'
  };
}

function normalizeDisplayValue(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized || EMPTY_VALUE;
}

function toComparableValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function formatLines(values: readonly (string | undefined)[] | undefined): string {
  return normalizeDisplayValue(values?.map((value) => value?.trim()).filter(Boolean).join('\n'));
}

function formatRelatedPeople(people: RelatedPersonView[] | undefined): string {
  return formatLines(people?.map((person) => person.name));
}

function formatFacts(facts: FactView[] | undefined): string {
  const values = facts?.map(formatFact).filter(Boolean) ?? [];
  return formatLines(values);
}

function formatOtherFacts(facts: FactView[] | undefined): string {
  return formatFacts(facts?.filter((fact) => fact.label !== 'Marriage'));
}

function formatFact(fact: FactView): string {
  return [
    fact.label,
    fact.date,
    fact.place,
    fact.value
  ].filter(Boolean).join(': ');
}

function formatGedcomMarriageFacts(
  document: NormalizedGedcomDocument,
  gedcomPersonId: string,
  key: 'date' | 'place'
): string {
  const person = document.people.find((candidate) => candidate.id === gedcomPersonId);
  if (!person) return EMPTY_VALUE;

  const facts = person.spouseFamilyIds
    .map((familyId) => document.families.find((family) => family.id === familyId))
    .flatMap((family) => family?.facts ?? [])
    .filter((fact) => fact.type === 'MARR');

  return formatLines(facts.map((fact) => getFactPart(fact, key)));
}

function formatFamilySearchMarriageFacts(
  facts: FactView[] | undefined,
  key: 'date' | 'place'
): string {
  return formatLines(
    facts
      ?.filter((fact) => fact.label === 'Marriage')
      .map((fact) => getFactPart(fact, key))
  );
}

function getFactPart(fact: NormalizedGedcomFact | FactView, key: 'date' | 'place'): string | undefined {
  return key === 'date' ? fact.date : fact.place;
}

function firstLine(value: string): string {
  return value.split('\n')[0]?.trim() || EMPTY_VALUE;
}

function hasMultipleLines(value: string): boolean {
  return value.includes('\n');
}

function formatMatchStatus(status: FamilySearchTraversalMetadata['matchStatus'] | undefined): string {
  if (status === 'matched') return 'Matched';
  if (status === 'missing') return 'Missing';
  if (status === 'ambiguous') return 'Ambiguous';
  return 'Not captured';
}
