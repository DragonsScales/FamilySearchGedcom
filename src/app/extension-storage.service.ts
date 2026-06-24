import { Injectable, inject } from '@angular/core';
import type {
  FamilySearchCapturedFact,
  FamilySearchCapturedRelationship,
  FamilySearchPageDebugLink,
  FamilySearchPageDebugSnapshot,
  FamilySearchRetrievedPerson
} from '../Interfaces/familysearch-person.interface';
import type {
  StoredGedcomImport,
  StoredStartPersonMapping
} from '../Interfaces/storage.interface';
import { ChromeStorageService } from './chrome-storage.service';

const GEDCOM_IMPORT_KEY = 'gedcomImport';
const START_PERSON_MAPPING_KEY = 'familySearchGedcomStartPersonMapping';
const COLLECTOR_STATE_KEY = 'familySearchGedcomCollectorState';

@Injectable({ providedIn: 'root' })
export class ExtensionStorageService {
  private readonly chromeStorage = inject(ChromeStorageService);

  async getGedcomImport(): Promise<StoredGedcomImport | null> {
    const stored = await this.chromeStorage.getValue(GEDCOM_IMPORT_KEY);
    const importedGedcom = isStoredGedcomImport(stored) ? stored : null;
    console.info('[FSG storage] loaded GEDCOM import', summarizeGedcomImport(importedGedcom));
    return importedGedcom;
  }

  watchGedcomImport(onChange: (value: StoredGedcomImport | null) => void): () => void {
    return this.chromeStorage.watchValue(GEDCOM_IMPORT_KEY, (value) => {
      onChange(isStoredGedcomImport(value) ? value : null);
    });
  }

  async saveGedcomImport(value: StoredGedcomImport): Promise<void> {
    await this.chromeStorage.setValue(GEDCOM_IMPORT_KEY, value);
  }

  async replaceGedcomImport(value: StoredGedcomImport): Promise<void> {
    await this.chromeStorage.removeValues([
      START_PERSON_MAPPING_KEY,
      COLLECTOR_STATE_KEY
    ]);
    await this.saveGedcomImport(value);
  }

  async clearGedcomImport(): Promise<void> {
    await this.chromeStorage.removeValues([
      GEDCOM_IMPORT_KEY,
      START_PERSON_MAPPING_KEY,
      COLLECTOR_STATE_KEY
    ]);
  }

  async getStartPersonMapping(): Promise<StoredStartPersonMapping | null> {
    const stored = await this.chromeStorage.getValue(START_PERSON_MAPPING_KEY);
    const mapping = toStoredStartPersonMapping(stored);
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
  return isRecord(value) &&
    'fileName' in value &&
    'document' in value;
}

function toStoredStartPersonMapping(value: unknown): StoredStartPersonMapping | null {
  if (!isRecord(value) || typeof value['gedcomPersonId'] !== 'string') return null;

  const retrievedFamilySearchPerson = isFamilySearchRetrievedPerson(value['retrievedFamilySearchPerson'])
    ? value['retrievedFamilySearchPerson']
    : undefined;

  return {
    gedcomPersonId: value['gedcomPersonId'],
    familySearchId: typeof value['familySearchId'] === 'string' ? value['familySearchId'] : '',
    updatedAt: typeof value['updatedAt'] === 'string' ? value['updatedAt'] : '',
    ...(retrievedFamilySearchPerson ? { retrievedFamilySearchPerson } : {})
  };
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

function isFamilySearchRetrievedPerson(value: unknown): value is FamilySearchRetrievedPerson {
  return isRecord(value) &&
    typeof value['familySearchId'] === 'string' &&
    typeof value['displayName'] === 'string' &&
    typeof value['url'] === 'string' &&
    typeof value['title'] === 'string' &&
    typeof value['capturedAt'] === 'string' &&
    Array.isArray(value['facts']) &&
    value['facts'].every(isFamilySearchCapturedFact) &&
    Array.isArray(value['relationships']) &&
    value['relationships'].every(isFamilySearchCapturedRelationship) &&
    (
      value['debugSnapshot'] === undefined ||
      isFamilySearchPageDebugSnapshot(value['debugSnapshot'])
    );
}

function isFamilySearchCapturedFact(value: unknown): value is FamilySearchCapturedFact {
  return isRecord(value) &&
    typeof value['type'] === 'string' &&
    Array.isArray(value['values']) &&
    value['values'].every((item) => typeof item === 'string') &&
    typeof value['rawText'] === 'string';
}

function isFamilySearchCapturedRelationship(value: unknown): value is FamilySearchCapturedRelationship {
  return isRecord(value) &&
    typeof value['personId'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['relationshipHint'] === 'string' &&
    typeof value['url'] === 'string' &&
    typeof value['context'] === 'string';
}

function isFamilySearchPageDebugSnapshot(value: unknown): value is FamilySearchPageDebugSnapshot {
  return isRecord(value) &&
    typeof value['url'] === 'string' &&
    typeof value['title'] === 'string' &&
    typeof value['expectedFamilySearchId'] === 'string' &&
    typeof value['documentReadyState'] === 'string' &&
    typeof value['readinessReason'] === 'string' &&
    typeof value['loadingSkeletonCount'] === 'number' &&
    typeof value['hasExpectedFamilySearchId'] === 'boolean' &&
    typeof value['bodyTextLength'] === 'number' &&
    typeof value['mainTextLength'] === 'number' &&
    Array.isArray(value['headings']) &&
    value['headings'].every((item) => typeof item === 'string') &&
    Array.isArray(value['visibleTextSample']) &&
    value['visibleTextSample'].every((item) => typeof item === 'string') &&
    typeof value['mainTextSample'] === 'string' &&
    typeof value['bodyTextSample'] === 'string' &&
    typeof value['mainHtmlSample'] === 'string' &&
    Array.isArray(value['familySearchPersonLinks']) &&
    value['familySearchPersonLinks'].every(isFamilySearchPageDebugLink);
}

function isFamilySearchPageDebugLink(value: unknown): value is FamilySearchPageDebugLink {
  return isRecord(value) &&
    typeof value['text'] === 'string' &&
    typeof value['href'] === 'string' &&
    (typeof value['personId'] === 'string' || value['personId'] === null) &&
    typeof value['ariaLabel'] === 'string' &&
    typeof value['role'] === 'string' &&
    typeof value['context'] === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}
