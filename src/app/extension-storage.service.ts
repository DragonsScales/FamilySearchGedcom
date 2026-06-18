import { Injectable, inject } from '@angular/core';
import type {
  StoredGedcomImport,
  StoredStartPersonMapping
} from '../Interfaces/storage.interface';
import { ChromeStorageService } from './chrome-storage.service';

const GEDCOM_IMPORT_KEY = 'gedcomImport';
const START_PERSON_MAPPING_KEY = 'familySearchGedcomStartPersonMapping';

@Injectable({ providedIn: 'root' })
export class ExtensionStorageService {
  private readonly chromeStorage = inject(ChromeStorageService);

  async getGedcomImport(): Promise<StoredGedcomImport | null> {
    const stored = await this.chromeStorage.getValue(GEDCOM_IMPORT_KEY);
    const importedGedcom = isStoredGedcomImport(stored) ? stored : null;
    console.info('[FSG storage] loaded GEDCOM import', summarizeGedcomImport(importedGedcom));
    return importedGedcom;
  }

  async saveGedcomImport(value: StoredGedcomImport): Promise<void> {
    await this.chromeStorage.setValue(GEDCOM_IMPORT_KEY, value);
  }

  async clearGedcomImport(): Promise<void> {
    await this.chromeStorage.removeValue(GEDCOM_IMPORT_KEY);
  }

  async getStartPersonMapping(): Promise<StoredStartPersonMapping | null> {
    const stored = await this.chromeStorage.getValue(START_PERSON_MAPPING_KEY);
    const mapping = isStoredStartPersonMapping(stored) ? stored : null;
    console.info('[FSG storage] loaded start person mapping', mapping);
    return mapping;
  }

  async saveStartPersonMapping(value: StoredStartPersonMapping): Promise<void> {
    await this.chromeStorage.setValue(START_PERSON_MAPPING_KEY, value);
  }

  async clearStartPersonMapping(): Promise<void> {
    await this.chromeStorage.removeValue(START_PERSON_MAPPING_KEY);
  }
}

function isStoredGedcomImport(value: unknown): value is StoredGedcomImport {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'fileName' in value &&
      'document' in value
  );
}

function isStoredStartPersonMapping(value: unknown): value is StoredStartPersonMapping {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'gedcomPersonId' in value &&
      'familySearchId' in value &&
      'updatedAt' in value
  );
}

function summarizeGedcomImport(value: StoredGedcomImport | null): unknown {
  if (!value) return null;

  return {
    fileName: value.fileName,
    fileSize: value.fileSize,
    importedAt: value.importedAt,
    people: value.document.people.length,
    families: value.document.families.length
  };
}
