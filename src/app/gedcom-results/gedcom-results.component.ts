import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  ExtensionStorageService,
  StoredGedcomImport,
  StoredStartPersonMapping
} from '../extension-storage.service';
import {
  NormalizedGedcomDocument,
  NormalizedGedcomFact,
  NormalizedGedcomPerson
} from '../gedcom-upload/gedcom-parser';

declare const chrome: {
  runtime?: {
    lastError?: {
      message?: string;
    };
  };
  storage?: {
    local: {
      get(keys: string | string[] | Record<string, unknown> | null, callback: (items: Record<string, unknown>) => void): void;
    };
  };
};

interface RelatedPersonView {
  id: string;
  name: string;
}

interface FactView {
  type: string;
  label: string;
  date?: string;
  place?: string;
  value?: string;
  notes: string[];
}

type SectionKey = 'parentsOpen' | 'childrenOpen' | 'siblingsOpen' | 'residencesOpen' | 'otherOpen';
type SettingKey = 'relationshipsOpen' | 'residencesOpen' | 'otherOpen';

interface CardSections {
  parentsOpen: boolean;
  childrenOpen: boolean;
  siblingsOpen: boolean;
  residencesOpen: boolean;
  otherOpen: boolean;
}

interface PersonCard {
  id: string;
  name: string;
  gender: string;
  alternateNames: string[];
  birth?: FactView;
  death?: FactView;
  christening?: FactView;
  burial?: FactView;
  parents: RelatedPersonView[];
  children: RelatedPersonView[];
  siblings: RelatedPersonView[];
  residences: FactView[];
  otherFacts: FactView[];
  sections: CardSections;
}

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

@Component({
  selector: 'fsg-gedcom-results',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './gedcom-results.component.html',
  styleUrl: './gedcom-results.component.css'
})
export class GedcomResultsComponent implements OnDestroy, OnInit {
  private readonly storage = inject(ExtensionStorageService);
  private delayedRefreshId: number | null = null;

  readonly importedGedcom = signal<StoredGedcomImport | null>(null);
  readonly loadErrorMessage = signal('');
  readonly debugStorageJson = signal('Loading chrome.storage.local...');
  readonly debugImportSummary = signal('Loading typed GEDCOM import...');
  readonly debugLastRefresh = signal('Not refreshed yet.');
  readonly selectedStartPersonId = signal('');
  readonly familySearchIdInput = signal('');
  readonly mappingStatusMessage = signal('');
  readonly mappingErrorMessage = signal('');
  readonly settings = signal<Record<SettingKey, boolean>>({
    relationshipsOpen: false,
    residencesOpen: false,
    otherOpen: false
  });
  readonly sectionOverrides = signal<Record<string, Partial<CardSections>>>({});
  readonly personCards = computed(() => {
    const importedGedcom = this.importedGedcom();
    if (!importedGedcom) return [];

    return this.buildPersonCards(
      importedGedcom.document,
      this.settings(),
      this.sectionOverrides()
    );
  });
  readonly selectedStartPerson = computed(() => {
    const selectedId = this.selectedStartPersonId();
    if (!selectedId) return null;
    return this.personCards().find((person) => person.id === selectedId) ?? null;
  });
  readonly normalizedFamilySearchId = computed(() => normalizeFamilySearchIdInput(this.familySearchIdInput()));
  readonly isFamilySearchIdComplete = computed(() => isValidFamilySearchId(this.normalizedFamilySearchId()));

  async ngOnInit(): Promise<void> {
    await this.loadStoredGedcom();
  }

  ngOnDestroy(): void {
    if (this.delayedRefreshId !== null) {
      window.clearTimeout(this.delayedRefreshId);
    }
  }

  async loadStoredGedcom(): Promise<void> {
    this.debugLastRefresh.set(`Refreshing`);

    await this.refreshStorageDebugPanel();

    try {
      const importedGedcom = await this.storage.getGedcomImport();
      this.importedGedcom.set(importedGedcom);
      this.debugImportSummary.set(JSON.stringify(summarizeImport(importedGedcom), null, 2));
      this.loadErrorMessage.set('');
      await this.loadStartPersonMapping(importedGedcom);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'The saved GEDCOM could not be loaded.';
      this.loadErrorMessage.set(message);
      this.importedGedcom.set(null);
      this.clearStartPersonSignals();
      this.debugImportSummary.set(`Error: ${message}`);
    }

    this.debugLastRefresh.set(`Refresh finished at ${new Date().toLocaleTimeString()}`);
  }

  async refreshStorageDebugPanel(): Promise<void> {
    try {
      const snapshot = await getChromeStorageSnapshot();
      this.debugStorageJson.set(JSON.stringify(snapshot, null, 2));
    } catch (error) {
      this.debugStorageJson.set(error instanceof Error ? error.message : 'Could not read chrome.storage.local.');
    }
  }

  setDefaultOpen(setting: SettingKey, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.settings.update((settings) => ({
      ...settings,
      [setting]: checked
    }));

    this.sectionOverrides.update((overrides) => clearOverridesForSetting(overrides, setting));
  }

  setSectionOpen(card: PersonCard, section: SectionKey, event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    this.sectionOverrides.update((overrides) => ({
      ...overrides,
      [card.id]: {
        ...overrides[card.id],
        [section]: open
      }
    }));
  }

  selectStartPerson(person: PersonCard): void {
    this.selectedStartPersonId.set(person.id);
    this.familySearchIdInput.set('');
    this.mappingErrorMessage.set('');
    this.mappingStatusMessage.set(`${person.name} is selected. Paste their FamilySearch ID when ready.`);
    void this.saveStartPersonMapping({ allowIncompleteFamilySearchId: true });
  }

  onFamilySearchIdInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const formatted = normalizeFamilySearchIdInput(input.value);
    input.value = formatted;
    this.familySearchIdInput.set(formatted);
    this.mappingErrorMessage.set('');

    if (isValidFamilySearchId(formatted)) {
      void this.saveStartPersonMapping();
    }
  }

  async saveStartPersonMapping(
    options: { allowIncompleteFamilySearchId?: boolean } = {}
  ): Promise<void> {
    const selectedPerson = this.selectedStartPerson();
    const familySearchId = this.normalizedFamilySearchId();

    if (!selectedPerson) {
      this.mappingErrorMessage.set('Choose a GEDCOM starting person first.');
      return;
    }

    if (familySearchId && !isValidFamilySearchId(familySearchId)) {
      this.mappingErrorMessage.set('FamilySearch IDs use seven letters or numbers, shown as XXXX-XXX.');
      return;
    }

    if (!familySearchId && !options.allowIncompleteFamilySearchId) {
      this.mappingErrorMessage.set('Paste a FamilySearch ID before saving this mapping.');
      return;
    }

    const mapping: StoredStartPersonMapping = {
      gedcomPersonId: selectedPerson.id,
      familySearchId,
      updatedAt: new Date().toISOString()
    };

    try {
      await this.storage.saveStartPersonMapping(mapping);
      this.mappingStatusMessage.set(familySearchId
        ? `Saved ${selectedPerson.name} as ${familySearchId}.`
        : `Saved ${selectedPerson.name} as the GEDCOM starting person.`);
      this.mappingErrorMessage.set('');
      await this.refreshStorageDebugPanel();
    } catch (error) {
      this.mappingErrorMessage.set(error instanceof Error ? error.message : 'Could not save the starting person mapping.');
    }
  }

  async clearStartPersonMapping(): Promise<void> {
    try {
      await this.storage.clearStartPersonMapping();
      this.clearStartPersonSignals();
      this.mappingStatusMessage.set('Starting person mapping cleared.');
      await this.refreshStorageDebugPanel();
    } catch (error) {
      this.mappingErrorMessage.set(error instanceof Error ? error.message : 'Could not clear the starting person mapping.');
    }
  }

  private async loadStartPersonMapping(importedGedcom: StoredGedcomImport | null): Promise<void> {
    if (!importedGedcom) {
      this.clearStartPersonSignals();
      return;
    }

    const mapping = await this.storage.getStartPersonMapping();
    const hasMappedPerson = Boolean(mapping && importedGedcom.document.people.some((person) => person.id === mapping.gedcomPersonId));
    if (!mapping || !hasMappedPerson) {
      this.clearStartPersonSignals();
      return;
    }

    this.selectedStartPersonId.set(mapping.gedcomPersonId);
    this.familySearchIdInput.set(normalizeFamilySearchIdInput(mapping.familySearchId));
    this.mappingErrorMessage.set('');
    this.mappingStatusMessage.set(mapping.familySearchId
      ? `Loaded starting FamilySearch ID ${normalizeFamilySearchIdInput(mapping.familySearchId)}.`
      : 'Loaded the saved GEDCOM starting person.');
  }

  private clearStartPersonSignals(): void {
    this.selectedStartPersonId.set('');
    this.familySearchIdInput.set('');
    this.mappingErrorMessage.set('');
    this.mappingStatusMessage.set('');
  }

  private buildPersonCards(
    document: NormalizedGedcomDocument,
    settings: Record<SettingKey, boolean>,
    sectionOverrides: Record<string, Partial<CardSections>>
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

function clearOverridesForSetting(
  overrides: Record<string, Partial<CardSections>>,
  setting: SettingKey
): Record<string, Partial<CardSections>> {
  const sectionsToClear: SectionKey[] = setting === 'relationshipsOpen'
    ? ['parentsOpen', 'childrenOpen', 'siblingsOpen']
    : setting === 'residencesOpen'
      ? ['residencesOpen']
      : ['otherOpen'];

  return Object.fromEntries(
    Object.entries(overrides)
      .map(([personId, personOverrides]) => {
        const nextOverrides = { ...personOverrides };
        for (const section of sectionsToClear) delete nextOverrides[section];
        return [personId, nextOverrides] as const;
      })
      .filter(([, personOverrides]) => Object.keys(personOverrides).length > 0)
  );
}

function normalizeFamilySearchIdInput(value: string): string {
  const compact = value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 7);
  if (compact.length <= 4) return compact;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function isValidFamilySearchId(value: string): boolean {
  return /^[A-Z0-9]{4}-[A-Z0-9]{3}$/.test(value);
}

function getChromeStorageSnapshot(): Promise<Record<string, unknown>> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return Promise.reject(new Error('chrome.storage.local is not available on this page.'));
  }

  return new Promise((resolve, reject) => {
    chrome.storage!.local.get(null, (items) => {
      const message = chrome.runtime?.lastError?.message;
      if (message) reject(new Error(message));
      else resolve(items);
    });
  });
}

function summarizeImport(value: StoredGedcomImport | null): unknown {
  if (!value) return null;

  return {
    fileName: value.fileName,
    fileSize: value.fileSize,
    importedAt: value.importedAt,
    people: value.document.people.length,
    families: value.document.families.length,
    metadata: value.document.metadata
  };
}
