import { Injectable } from '@angular/core';
import type { NormalizedGedcomDocument } from './gedcom-upload/gedcom-parser';

declare const chrome: {
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

const GEDCOM_IMPORT_KEY = 'familySearchGedcomImport';

@Injectable({ providedIn: 'root' })
export class ExtensionStorageService {
  async getGedcomImport(): Promise<StoredGedcomImport | null> {
    const stored = await this.getStorageValue(GEDCOM_IMPORT_KEY);
    return isStoredGedcomImport(stored) ? stored : null;
  }

  async saveGedcomImport(value: StoredGedcomImport): Promise<void> {
    await this.setStorageValue(GEDCOM_IMPORT_KEY, value);
  }

  async clearGedcomImport(): Promise<void> {
    await this.removeStorageValue(GEDCOM_IMPORT_KEY);
  }

  private getStorageValue(key: string): Promise<unknown> {
    if (hasChromeStorage()) {
      return new Promise((resolve) => {
        chrome.storage!.local.get(key, (items) => resolve(items[key]));
      });
    }

    const raw = window.localStorage.getItem(key);
    return Promise.resolve(raw ? JSON.parse(raw) : null);
  }

  private setStorageValue(key: string, value: unknown): Promise<void> {
    if (hasChromeStorage()) {
      return new Promise((resolve) => {
        chrome.storage!.local.set({ [key]: value }, resolve);
      });
    }

    window.localStorage.setItem(key, JSON.stringify(value));
    return Promise.resolve();
  }

  private removeStorageValue(key: string): Promise<void> {
    if (hasChromeStorage()) {
      return new Promise((resolve) => {
        chrome.storage!.local.remove(key, resolve);
      });
    }

    window.localStorage.removeItem(key);
    return Promise.resolve();
  }
}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

function isStoredGedcomImport(value: unknown): value is StoredGedcomImport {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'fileName' in value &&
      'document' in value
  );
}
