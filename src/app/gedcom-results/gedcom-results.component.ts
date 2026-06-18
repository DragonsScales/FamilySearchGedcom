import { Component, OnInit, computed, inject, signal } from '@angular/core';
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
import { CardSettingsComponent } from '../card-settings/card-settings.component';
import { ChromeStorageService } from '../chrome-storage.service';
import { ExtensionStorageService } from '../extension-storage.service';
import { PersonCardComponent } from '../person-card/person-card.component';
import { buildGedcomPersonCards } from '../person-card/gedcom-person-card.mapper';
import { clearOverridesForSetting } from '../person-card/person-card-sections';
import { StorageDebugPanelComponent } from '../storage-debug-panel/storage-debug-panel.component';

@Component({
  selector: 'fsg-gedcom-results',
  standalone: true,
  imports: [
    CardSettingsComponent,
    PersonCardComponent,
    RouterLink,
    StorageDebugPanelComponent
  ],
  templateUrl: './gedcom-results.component.html',
  styleUrl: './gedcom-results.component.css'
})
export class GedcomResultsComponent implements OnInit {
  private readonly storage = inject(ExtensionStorageService);
  private readonly chromeStorage = inject(ChromeStorageService);

  readonly importedGedcom = signal<StoredGedcomImport | null>(null);
  readonly loadErrorMessage = signal('');
  readonly debugStorageJson = signal('Loading chrome.storage.local...');
  readonly debugImportSummary = signal('Loading typed GEDCOM import...');
  readonly debugLastRefresh = signal('Not refreshed yet.');
  readonly selectedStartPersonId = signal('');
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

  async ngOnInit(): Promise<void> {
    await this.loadStoredGedcom();
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
    this.mappingErrorMessage.set('');
    this.mappingStatusMessage.set(`${person.name} is selected as the GEDCOM starting person.`);
    void this.saveStartPersonMapping(person);
  }

  async saveStartPersonMapping(selectedPerson: PersonCard): Promise<void> {
    if (!this.importedGedcom()) {
      this.mappingErrorMessage.set('Choose a GEDCOM starting person first.');
      return;
    }

    const existingMapping = await this.storage.getStartPersonMapping();
    const familySearchId = existingMapping?.gedcomPersonId === selectedPerson.id
      ? existingMapping.familySearchId
      : '';

    const mapping: StoredStartPersonMapping = {
      gedcomPersonId: selectedPerson.id,
      familySearchId,
      updatedAt: new Date().toISOString()
    };

    try {
      await this.storage.saveStartPersonMapping(mapping);
      this.mappingStatusMessage.set(`Saved ${selectedPerson.name} as the GEDCOM starting person.`);
      this.mappingErrorMessage.set('');
      await this.refreshStorageDebugPanel();
    } catch (error) {
      this.mappingErrorMessage.set(error instanceof Error ? error.message : 'Could not save the starting person mapping.');
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
    this.mappingErrorMessage.set('');
    this.mappingStatusMessage.set('Loaded the saved GEDCOM starting person.');
  }

  private clearStartPersonSignals(): void {
    this.selectedStartPersonId.set('');
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
