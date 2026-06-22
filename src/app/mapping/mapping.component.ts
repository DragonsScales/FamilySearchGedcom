import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CardSettings } from '../../Interfaces/card-settings.interface';
import type { PersonCard } from '../../Interfaces/person-card.interface';
import type {
  StoredGedcomImport,
  StoredStartPersonMapping
} from '../../Interfaces/storage.interface';
import { ExtensionStorageService } from '../extension-storage.service';
import { FamilySearchPersonService } from '../familysearch-person.service';
import { isValidFamilySearchId, normalizeFamilySearchIdInput } from '../familysearch-id';
import { buildFamilySearchPersonCard } from '../person-card/familysearch-person-card.mapper';
import { PersonCardComponent } from '../person-card/person-card.component';
import { buildGedcomPersonCards } from '../person-card/gedcom-person-card.mapper';
import { StartPersonMappingComponent } from '../start-person-mapping/start-person-mapping.component';

@Component({
  selector: 'fsg-mapping',
  standalone: true,
  imports: [PersonCardComponent, RouterLink, StartPersonMappingComponent],
  templateUrl: './mapping.component.html',
  styleUrl: './mapping.component.css'
})
export class MappingComponent implements OnInit {
  private readonly storage = inject(ExtensionStorageService);
  private readonly familySearchPerson = inject(FamilySearchPersonService);
  private readonly defaultCardSettings: CardSettings = {
    relationshipsOpen: false,
    residencesOpen: false,
    otherOpen: false
  };

  readonly importedGedcom = signal<StoredGedcomImport | null>(null);
  readonly storedMapping = signal<StoredStartPersonMapping | null>(null);
  readonly loadErrorMessage = signal('');
  readonly familySearchIdInput = signal('');
  readonly accountAccessConsent = signal(false);
  readonly mappingStatusMessage = signal('');
  readonly mappingErrorMessage = signal('');
  readonly isRetrievingFamilySearchPerson = signal(false);
  readonly retrievedFamilySearchPersonCard = signal<PersonCard | null>(null);

  readonly startPerson = computed<PersonCard | null>(() => {
    const importedGedcom = this.importedGedcom();
    const mapping = this.storedMapping();
    if (!importedGedcom || !mapping) return null;

    return buildGedcomPersonCards(
      importedGedcom.document,
      this.defaultCardSettings,
      {}
    ).find((person) => person.id === mapping.gedcomPersonId) ?? null;
  });
  readonly normalizedFamilySearchId = computed(() => normalizeFamilySearchIdInput(this.familySearchIdInput()));
  readonly isFamilySearchIdComplete = computed(() => isValidFamilySearchId(this.normalizedFamilySearchId()));

  async ngOnInit(): Promise<void> {
    await this.loadMappingContext();
  }

  async loadMappingContext(): Promise<void> {
    try {
      const importedGedcom = await this.storage.getGedcomImport();
      const mapping = await this.storage.getStartPersonMapping();
      const hasMappedPerson = Boolean(
        importedGedcom &&
        mapping &&
        importedGedcom.document.people.some((person) => person.id === mapping.gedcomPersonId)
      );

      this.importedGedcom.set(importedGedcom);
      this.storedMapping.set(hasMappedPerson ? mapping : null);
      this.familySearchIdInput.set(hasMappedPerson && mapping ? normalizeFamilySearchIdInput(mapping.familySearchId) : '');
      this.loadErrorMessage.set('');
      this.mappingErrorMessage.set('');
      this.mappingStatusMessage.set(getInitialMappingStatus(importedGedcom, hasMappedPerson ? mapping : null));
    } catch (error) {
      this.importedGedcom.set(null);
      this.storedMapping.set(null);
      this.familySearchIdInput.set('');
      this.loadErrorMessage.set(error instanceof Error ? error.message : 'Could not load the saved mapping context.');
    }
  }

  onFamilySearchIdInput(value: string): void {
    const formatted = normalizeFamilySearchIdInput(value);
    this.familySearchIdInput.set(formatted);
    this.mappingErrorMessage.set('');
    this.retrievedFamilySearchPersonCard.set(null);
  }

  setAccountAccessConsent(consent: boolean): void {
    this.accountAccessConsent.set(consent);
    this.mappingErrorMessage.set('');
  }

  async retrieveFamilySearchPerson(): Promise<void> {
    const selectedPerson = this.startPerson();
    const familySearchId = this.normalizedFamilySearchId();

    if (!selectedPerson) {
      this.mappingErrorMessage.set('Choose a GEDCOM starting person from Results first.');
      return;
    }

    if (!familySearchId) {
      this.mappingErrorMessage.set('Paste a FamilySearch ID before retrieving this person.');
      return;
    }

    if (!isValidFamilySearchId(familySearchId)) {
      this.mappingErrorMessage.set('FamilySearch IDs use seven letters or numbers, shown as XXXX-XXX.');
      return;
    }

    if (!this.accountAccessConsent()) {
      this.mappingErrorMessage.set('Confirm FamilySearch account access before retrieving this person.');
      return;
    }

    this.isRetrievingFamilySearchPerson.set(true);
    this.mappingErrorMessage.set('');
    this.mappingStatusMessage.set(`Retrieving ${familySearchId} from FamilySearch.`);

    try {
      const retrievedPerson = await this.familySearchPerson.retrievePerson(familySearchId);
      const retrievedFamilySearchId = normalizeFamilySearchIdInput(retrievedPerson.familySearchId);
      this.familySearchIdInput.set(retrievedFamilySearchId);
      this.retrievedFamilySearchPersonCard.set(buildFamilySearchPersonCard(retrievedPerson));
      await this.saveStartPersonMapping(selectedPerson, retrievedFamilySearchId);
    } catch (error) {
      this.retrievedFamilySearchPersonCard.set(null);
      this.mappingErrorMessage.set(error instanceof Error ? error.message : 'Could not retrieve the FamilySearch person.');
      this.mappingStatusMessage.set('');
    } finally {
      this.isRetrievingFamilySearchPerson.set(false);
    }
  }

  private async saveStartPersonMapping(selectedPerson: PersonCard, familySearchId: string): Promise<void> {
    const mapping: StoredStartPersonMapping = {
      gedcomPersonId: selectedPerson.id,
      familySearchId,
      updatedAt: new Date().toISOString()
    };

    try {
      await this.storage.saveStartPersonMapping(mapping);
      this.storedMapping.set(mapping);
      this.mappingStatusMessage.set(`Saved ${selectedPerson.name} as ${familySearchId}.`);
      this.mappingErrorMessage.set('');
    } catch (error) {
      this.mappingErrorMessage.set(error instanceof Error ? error.message : 'Could not save the starting person mapping.');
    }
  }

  async clearStartPersonMapping(): Promise<void> {
    try {
      await this.storage.clearStartPersonMapping();
      this.storedMapping.set(null);
      this.familySearchIdInput.set('');
      this.retrievedFamilySearchPersonCard.set(null);
      this.mappingErrorMessage.set('');
      this.mappingStatusMessage.set('Starting person mapping cleared.');
    } catch (error) {
      this.mappingErrorMessage.set(error instanceof Error ? error.message : 'Could not clear the starting person mapping.');
    }
  }
}

function getInitialMappingStatus(
  importedGedcom: StoredGedcomImport | null,
  mapping: StoredStartPersonMapping | null
): string {
  if (!importedGedcom) return 'Upload a GEDCOM file before mapping.';
  if (!mapping) return 'Select a GEDCOM starting person from Results before saving a FamilySearch ID.';
  if (mapping.familySearchId) return `Loaded saved FamilySearch ID ${normalizeFamilySearchIdInput(mapping.familySearchId)}.`;
  return 'Loaded the saved GEDCOM starting person. Paste the matching FamilySearch ID.';
}
