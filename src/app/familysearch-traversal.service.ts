import { Injectable, inject } from '@angular/core';
import type {
  ChromeRuntimeMessageApi,
  ChromeRuntimeMessageResponse
} from '../Interfaces/chrome-runtime.interface';
import type {
  FamilySearchCaptureRecord,
  FamilySearchCollectorOptions,
  FamilySearchCollectorState,
  FamilySearchTraversalMetadata,
  FamilySearchTraversalQueueItem,
  FamilySearchTraversalStartOptions
} from '../Interfaces/familysearch-collector.interface';
import type {
  FamilySearchCapturedFact,
  FamilySearchCapturedRelationship,
  FamilySearchPageDebugLink,
  FamilySearchPageDebugSnapshot
} from '../Interfaces/familysearch-person.interface';
import { ChromeStorageService } from './chrome-storage.service';

declare const chrome: ChromeRuntimeMessageApi;

const COLLECTOR_STATE_KEY = 'familySearchGedcomCollectorState';

@Injectable({ providedIn: 'root' })
export class FamilySearchTraversalService {
  private readonly chromeStorage = inject(ChromeStorageService);

  async getState(): Promise<FamilySearchCollectorState> {
    return normalizeCollectorState(await this.chromeStorage.getValue(COLLECTOR_STATE_KEY));
  }

  async startTraversal(options: FamilySearchTraversalStartOptions): Promise<FamilySearchCollectorState> {
    await this.sendMessage({
      type: 'START_TRAVERSAL',
      payload: options
    });
    return this.getState();
  }

  async stopTraversal(): Promise<FamilySearchCollectorState> {
    await this.sendMessage({ type: 'STOP_TRAVERSAL' });
    return this.getState();
  }

  async resetTraversal(): Promise<FamilySearchCollectorState> {
    await this.sendMessage({ type: 'RESET_COLLECTOR' });
    return this.getState();
  }

  private sendMessage(message: unknown): Promise<ChromeRuntimeMessageResponse> {
    this.assertRuntimeAvailable();

    return new Promise((resolve, reject) => {
      chrome.runtime!.sendMessage(message, (response) => {
        const errorMessage = chrome.runtime?.lastError?.message;
        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }

        if (!isChromeRuntimeMessageResponse(response)) {
          reject(new Error('The extension returned an invalid traversal response.'));
          return;
        }

        if (!response.ok) {
          reject(new Error(response.error ?? 'The FamilySearch traversal request failed.'));
          return;
        }

        resolve(response);
      });
    });
  }

  private assertRuntimeAvailable(): void {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime messaging is not available. Open this page from the installed extension.');
    }
  }
}

function normalizeCollectorState(value: unknown): FamilySearchCollectorState {
  const state = isRecord(value) ? value : {};
  const options = normalizeCollectorOptions(state['options']);

  return {
    running: getBoolean(state['running']),
    activeTabId: getNullableNumber(state['activeTabId']),
    activeItem: normalizeQueueItem(state['activeItem']),
    queue: getArray(state['queue']).map(normalizeQueueItem).filter((item): item is FamilySearchTraversalQueueItem => item !== null),
    visitedPersonIds: getArray(state['visitedPersonIds']).filter((item): item is string => typeof item === 'string'),
    records: getArray(state['records']).map(normalizeCaptureRecord).filter((record): record is FamilySearchCaptureRecord => record !== null),
    options,
    lastEvent: getString(state['lastEvent'], 'Idle'),
    updatedAt: getString(state['updatedAt'], '')
  };
}

function normalizeCollectorOptions(value: unknown): FamilySearchCollectorOptions {
  const options = isRecord(value) ? value : {};
  return {
    maxPages: getNumber(options['maxPages'], 25),
    maxPagesEnabled: getBoolean(options['maxPagesEnabled']),
    allowedIds: getArray(options['allowedIds']).filter((item): item is string => typeof item === 'string')
  };
}

function normalizeQueueItem(value: unknown): FamilySearchTraversalQueueItem | null {
  if (!isRecord(value)) return null;

  return {
    personId: getString(value['personId']),
    gedcomPersonId: getString(value['gedcomPersonId']),
    name: getString(value['name']),
    relationshipHint: getString(value['relationshipHint']),
    fromPersonId: getNullableString(value['fromPersonId']),
    fromGedcomPersonId: getNullableString(value['fromGedcomPersonId']),
    depth: getNumber(value['depth'], 0),
    url: getString(value['url']),
    branch: getTraversalBranch(value['branch']),
    matchNote: getOptionalString(value['matchNote'])
  };
}

function normalizeCaptureRecord(value: unknown): FamilySearchCaptureRecord | null {
  if (!isRecord(value)) return null;

  return {
    schemaVersion: getOptionalNumber(value['schemaVersion']),
    source: getOptionalString(value['source']),
    capturedAt: getOptionalString(value['capturedAt']),
    url: getOptionalString(value['url']),
    title: getOptionalString(value['title']),
    person: normalizeCapturedPerson(value['person']),
    facts: getArray(value['facts']).filter(isFamilySearchCapturedFact),
    relationships: getArray(value['relationships']).filter(isFamilySearchCapturedRelationship),
    raw: isFamilySearchPageDebugSnapshot(value['raw']) ? value['raw'] : undefined,
    traversal: normalizeTraversalMetadata(value['traversal'])
  };
}

function normalizeCapturedPerson(value: unknown): FamilySearchCaptureRecord['person'] {
  if (!isRecord(value)) return undefined;

  return {
    familySearchId: typeof value['familySearchId'] === 'string' || value['familySearchId'] === null
      ? value['familySearchId']
      : undefined,
    displayName: getOptionalString(value['displayName'])
  };
}

function normalizeTraversalMetadata(value: unknown): FamilySearchTraversalMetadata | undefined {
  if (!isRecord(value)) return undefined;

  return {
    source: getString(value['source']),
    depth: getNumber(value['depth'], 0),
    fromPersonId: getNullableString(value['fromPersonId']),
    gedcomPersonId: getNullableString(value['gedcomPersonId']),
    fromGedcomPersonId: getNullableString(value['fromGedcomPersonId']),
    relationshipHint: getNullableString(value['relationshipHint']),
    branch: getTraversalBranch(value['branch']),
    matchStatus: getTraversalMatchStatus(value['matchStatus']),
    matchNote: getOptionalString(value['matchNote'])
  };
}

function isChromeRuntimeMessageResponse(value: unknown): value is ChromeRuntimeMessageResponse {
  return isRecord(value) && typeof value['ok'] === 'boolean';
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

function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function getString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getTraversalBranch(value: unknown): 'root' | 'ancestor' | 'descendant' {
  return value === 'root' || value === 'ancestor' || value === 'descendant' ? value : 'root';
}

function getTraversalMatchStatus(value: unknown): 'matched' | 'missing' | 'ambiguous' | undefined {
  return value === 'matched' || value === 'missing' || value === 'ambiguous' ? value : undefined;
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
