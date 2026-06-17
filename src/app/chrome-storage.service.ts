import { Injectable } from '@angular/core';
import type {
  ChromeStorageApi,
  ChromeStorageKeyRequest
} from '../Interfaces/chrome-storage.interface';

declare const chrome: ChromeStorageApi;

const STORAGE_TIMEOUT_MS = 2500;

@Injectable({ providedIn: 'root' })
export class ChromeStorageService {
  async getValue(key: string): Promise<unknown> {
    this.assertAvailable();
    console.info(`[Chrome storage] reading ${key} from chrome.storage.local`);

    const items = await withTimeout(
      this.get(key),
      STORAGE_TIMEOUT_MS,
      `Timed out reading ${key} from chrome.storage.local.`
    );
    console.info(`[Chrome storage] read ${key}`, items);
    await this.logSnapshot(`after reading ${key}`);
    return items[key];
  }

  async setValue(key: string, value: unknown): Promise<void> {
    this.assertAvailable();
    console.info(`[Chrome storage] saving ${key} to chrome.storage.local`, value);

    await withTimeout(
      this.set({ [key]: value }),
      STORAGE_TIMEOUT_MS,
      `Timed out saving ${key} to chrome.storage.local.`
    );
    await this.logSnapshot(`after saving ${key}`);
  }

  async removeValue(key: string): Promise<void> {
    this.assertAvailable();
    console.info(`[Chrome storage] removing ${key} from chrome.storage.local`);

    await withTimeout(
      this.remove(key),
      STORAGE_TIMEOUT_MS,
      `Timed out removing ${key} from chrome.storage.local.`
    );
    await this.logSnapshot(`after removing ${key}`);
  }

  async getSnapshot(): Promise<Record<string, unknown>> {
    this.assertAvailable();
    return withTimeout(
      this.get(null),
      STORAGE_TIMEOUT_MS,
      'Timed out reading chrome.storage.local debug snapshot.'
    );
  }

  private hasStorage(): boolean {
    return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
  }

  private assertAvailable(): void {
    if (!this.hasStorage()) {
      throw new Error('chrome.storage.local is not available. Open this page from the installed extension.');
    }
  }

  private get(keys: ChromeStorageKeyRequest): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      chrome.storage!.local.get(keys, (items) => {
        const error = this.getStorageError();
        if (error) reject(error);
        else resolve(items);
      });
    });
  }

  private set(items: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage!.local.set(items, () => {
        const error = this.getStorageError();
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private remove(keys: string | string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage!.local.remove(keys, () => {
        const error = this.getStorageError();
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private getStorageError(): Error | null {
    const message = chrome.runtime?.lastError?.message;
    return message ? new Error(message) : null;
  }

  private async logSnapshot(label: string): Promise<void> {
    try {
      console.info(`[Chrome storage] ${label} snapshot`, await this.getSnapshot());
    } catch (error) {
      console.warn('[Chrome storage] could not print debug snapshot', error);
    }
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
