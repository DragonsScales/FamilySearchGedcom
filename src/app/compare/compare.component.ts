import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  FamilySearchCollectorState,
  FamilySearchTraversalMetadata
} from '../../Interfaces/familysearch-collector.interface';
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
export class CompareComponent implements OnInit {
  private readonly storage = inject(ExtensionStorageService);
  private readonly traversal = inject(FamilySearchTraversalService);

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
    await this.loadComparisonContext();
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
      fields: buildComparisonFields(gedcomCard, familySearchCard)
    };
  });
}

function buildComparisonFields(
  gedcomCard: PersonCard | null,
  familySearchCard: PersonCard | null
): ComparisonField[] {
  const fieldInputs = [
    fieldInput('Name', gedcomCard?.name, familySearchCard?.name),
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
    fieldInput('Children', formatRelatedPeople(gedcomCard?.children), formatRelatedPeople(familySearchCard?.children)),
    fieldInput('Siblings', formatRelatedPeople(gedcomCard?.siblings), formatRelatedPeople(familySearchCard?.siblings)),
    fieldInput('Residences', formatFacts(gedcomCard?.residences), formatFacts(familySearchCard?.residences)),
    fieldInput('Other', formatFacts(gedcomCard?.otherFacts), formatFacts(familySearchCard?.otherFacts))
  ];

  return fieldInputs.map((input) => ({
    label: input.label,
    gedcomValue: input.gedcomValue,
    familySearchValue: input.familySearchValue,
    preferred: choosePreferredValue(input.gedcomValue, input.familySearchValue)
  }));
}

function fieldInput(label: string, gedcomValue: string | undefined, familySearchValue: string | undefined): {
  label: string;
  gedcomValue: string;
  familySearchValue: string;
} {
  return {
    label,
    gedcomValue: normalizeDisplayValue(gedcomValue),
    familySearchValue: normalizeDisplayValue(familySearchValue)
  };
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

function formatRelatedPeople(people: RelatedPersonView[] | undefined): string {
  return people?.map((person) => person.name).filter(Boolean).join(', ') || EMPTY_VALUE;
}

function formatFacts(facts: FactView[] | undefined): string {
  const values = facts?.map(formatFact).filter(Boolean) ?? [];
  return values.join('; ') || EMPTY_VALUE;
}

function formatFact(fact: FactView): string {
  return [
    fact.label,
    fact.date,
    fact.place,
    fact.value
  ].filter(Boolean).join(': ');
}

function formatMatchStatus(status: FamilySearchTraversalMetadata['matchStatus'] | undefined): string {
  if (status === 'matched') return 'Matched';
  if (status === 'missing') return 'Missing';
  if (status === 'ambiguous') return 'Ambiguous';
  return 'Not captured';
}
