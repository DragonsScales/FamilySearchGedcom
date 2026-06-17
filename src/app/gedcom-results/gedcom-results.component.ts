import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  CardSettingKey,
  CardSettings
} from '../../Interfaces/card-settings.interface';
import type {
  CardSectionOverrides,
  PersonCard,
  SectionKey
} from '../../Interfaces/person-card.interface';
import type {
  StoredGedcomImport,
  StoredStartPersonMapping
} from '../../Interfaces/storage.interface';
import { isValidFamilySearchId, normalizeFamilySearchIdInput } from '../familysearch-id';
import { CardSettingsComponent } from '../card-settings/card-settings.component';
import { ChromeStorageService } from '../chrome-storage.service';
import { ExtensionStorageService } from '../extension-storage.service';
import { PersonCardComponent } from '../person-card/person-card.component';
import { buildGedcomPersonCards } from '../person-card/gedcom-person-card.mapper';
import { clearOverridesForSetting } from '../person-card/person-card-sections';
import { StartPersonMappingComponent } from '../start-person-mapping/start-person-mapping.component';
import { StorageDebugPanelComponent } from '../storage-debug-panel/storage-debug-panel.component';

@Component({
  selector: 'fsg-gedcom-results',
  standalone: true,
  imports: [
    CardSettingsComponent,
    PersonCardComponent,
    RouterLink,
    StartPersonMappingComponent,
    StorageDebugPanelComponent
  ],
  templateUrl: './gedcom-results.component.html',
  styleUrl: './gedcom-results.component.css'
})
export class GedcomResultsComponent implements OnDestroy, OnInit {
  private readonly storage = inject(ExtensionStorageService);
  private readonly chromeStorage = inject(ChromeStorageService);
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
  readonly settings = signal<CardSettings>({
    relationshipsOpen: false,
    residencesOpen: false,
    otherOpen: false
  });
  readonly sectionOverrides = signal<CardSectionOverrides>({});
  readonly personCards = computed(() => {
    const importedGedcom = this.importedGedcom();
    if (!importedGedcom) return [];

    return buildGedcomPersonCards(
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
      const snapshot = await this.chromeStorage.getSnapshot();
      this.debugStorageJson.set(JSON.stringify(snapshot, null, 2));
    } catch (error) {
      this.debugStorageJson.set(error instanceof Error ? error.message : 'Could not read chrome.storage.local.');
    }
  }

  setDefaultOpen(setting: CardSettingKey, open: boolean): void {
    this.settings.update((settings) => ({
      ...settings,
      [setting]: open
    }));

    this.sectionOverrides.update((overrides) => clearOverridesForSetting(overrides, setting));
  }

  setSectionOpen(card: PersonCard, section: SectionKey, open: boolean): void {
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

  onFamilySearchIdInput(value: string): void {
    const formatted = normalizeFamilySearchIdInput(value);
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
