import { Injectable } from '@angular/core';
import type { NormalizedGedcomDocument } from './gedcom-upload/gedcom-parser';

declare const chrome: {
  runtime?: {
    lastError?: {
      message?: string;
    };
  };
  storage?: {
    local: {
      get(keys: string | string[] | Record<string, unknown> | null, callback: (items: Record<string, unknown>) => void): void;
      set(items: Record<string, unknown>, callback?: () => void): void;
      remove(keys: string | string[], callback?: () => void): void;
    };
  };
};

export interface StoredGedcomImport {
  fileName: string;
  fileSize: number;
  importedAt: string;
  document: NormalizedGedcomDocument;
}

export interface StoredStartPersonMapping {
  gedcomPersonId: string;
  familySearchId: string;
  updatedAt: string;
}

const GEDCOM_IMPORT_KEY = 'familySearchGedcomImport';
const START_PERSON_MAPPING_KEY = 'familySearchGedcomStartPersonMapping';
const STORAGE_TIMEOUT_MS = 2500;

@Injectable({ providedIn: 'root' })
export class ExtensionStorageService {
  async getGedcomImport(): Promise<StoredGedcomImport | null> {
    const stored = await this.getStorageValue(GEDCOM_IMPORT_KEY);
    const importedGedcom = isStoredGedcomImport(stored) ? stored : null;
    console.info('[FSG storage] loaded GEDCOM import', summarizeGedcomImport(importedGedcom));
    return importedGedcom;
  }

  async saveGedcomImport(value: StoredGedcomImport): Promise<void> {
    await this.setStorageValue(GEDCOM_IMPORT_KEY, value);
  }

  async clearGedcomImport(): Promise<void> {
    await this.removeStorageValue(GEDCOM_IMPORT_KEY);
  }

  async getStartPersonMapping(): Promise<StoredStartPersonMapping | null> {
    const stored = await this.getStorageValue(START_PERSON_MAPPING_KEY);
    const mapping = isStoredStartPersonMapping(stored) ? stored : null;
    console.info('[FSG storage] loaded start person mapping', mapping);
    return mapping;
  }

  async saveStartPersonMapping(value: StoredStartPersonMapping): Promise<void> {
    await this.setStorageValue(START_PERSON_MAPPING_KEY, value);
  }

  async clearStartPersonMapping(): Promise<void> {
    await this.removeStorageValue(START_PERSON_MAPPING_KEY);
  }

  private getStorageValue(key: string): Promise<unknown> {
    assertChromeStorage();
    console.info(`[FSG storage] reading ${key} from chrome.storage.local`);

    return withTimeout(chromeStorageGet(key), STORAGE_TIMEOUT_MS, `Timed out reading ${key} from chrome.storage.local.`)
      .then(async (items) => {
        console.info(`[FSG storage] read ${key}`, items);
        await logStorageSnapshot(`after reading ${key}`);
        return items[key];
      });
  }

  private setStorageValue(key: string, value: unknown): Promise<void> {
    assertChromeStorage();
    console.info(`[FSG storage] saving ${key} to chrome.storage.local`, value);

    return withTimeout(
      chromeStorageSet({ [key]: value }),
      STORAGE_TIMEOUT_MS,
      `Timed out saving ${key} to chrome.storage.local.`
    ).then(() => logStorageSnapshot(`after saving ${key}`));
  }

  private removeStorageValue(key: string): Promise<void> {
    assertChromeStorage();
    console.info(`[FSG storage] removing ${key} from chrome.storage.local`);

    return withTimeout(
      chromeStorageRemove(key),
      STORAGE_TIMEOUT_MS,
      `Timed out removing ${key} from chrome.storage.local.`
    ).then(() => logStorageSnapshot(`after removing ${key}`));
  }
}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

function assertChromeStorage(): void {
  if (!hasChromeStorage()) {
    throw new Error('chrome.storage.local is not available. Open this page from the installed extension.');
  }
}

function chromeStorageGet(keys: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage!.local.get(keys, (items) => {
      const error = getChromeStorageError();
      if (error) reject(error);
      else resolve(items);
    });
  });
}

function chromeStorageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage!.local.set(items, () => {
      const error = getChromeStorageError();
      if (error) reject(error);
      else resolve();
    });
  });
}

function chromeStorageRemove(keys: string | string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage!.local.remove(keys, () => {
      const error = getChromeStorageError();
      if (error) reject(error);
      else resolve();
    });
  });
}

function getChromeStorageError(): Error | null {
  const message = chrome.runtime?.lastError?.message;
  return message ? new Error(message) : null;
}

async function logStorageSnapshot(label: string): Promise<void> {
  try {
    const snapshot = await withTimeout(
      chromeStorageGet(null),
      STORAGE_TIMEOUT_MS,
      'Timed out reading chrome.storage.local debug snapshot.'
    );
    console.info(`[FSG storage] ${label} snapshot`, snapshot);
  } catch (error) {
    console.warn('[FSG storage] could not print debug snapshot', error);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timeoutId));
  });
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
