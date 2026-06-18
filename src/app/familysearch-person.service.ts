import { Injectable } from '@angular/core';
import type {
  FamilySearchCapturedFact,
  FamilySearchCapturedRelationship,
  FamilySearchPageDebugLink,
  FamilySearchPageDebugSnapshot,
  FamilySearchRetrievedPerson
} from '../Interfaces/familysearch-person.interface';
import type {
  ChromeRuntimeMessageApi,
  ChromeRuntimeMessageResponse
} from '../Interfaces/chrome-runtime.interface';

declare const chrome: ChromeRuntimeMessageApi;

const RETRIEVE_PERSON_MESSAGE_TYPE = 'RETRIEVE_FAMILYSEARCH_PERSON';

@Injectable({ providedIn: 'root' })
export class FamilySearchPersonService {
  async retrievePerson(familySearchId: string): Promise<FamilySearchRetrievedPerson> {
    const response = await this.sendMessage({
      type: RETRIEVE_PERSON_MESSAGE_TYPE,
      payload: { familySearchId }
    });

    if (!response.ok) {
      throw new Error(response.error ?? 'Could not retrieve the FamilySearch person.');
    }

    if (!isFamilySearchRetrievedPerson(response.result)) {
      throw new Error('The extension returned an invalid FamilySearch person response.');
    }

    logFamilySearchTabDump(response.result);
    return response.result;
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
        if (isChromeRuntimeMessageResponse(response)) resolve(response);
        else reject(new Error('The extension returned an invalid message response.'));
      });
    });
  }

  private assertRuntimeAvailable(): void {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      throw new Error('chrome.runtime messaging is not available. Open this page from the installed extension.');
    }
  }
}

function isChromeRuntimeMessageResponse(value: unknown): value is ChromeRuntimeMessageResponse {
  return isRecord(value) && typeof value['ok'] === 'boolean';
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

function logFamilySearchTabDump(person: FamilySearchRetrievedPerson): void {
  console.groupCollapsed(`[FSG mapping] FamilySearch tab dump for ${person.familySearchId}`);
  console.info('Retrieved person card source', person);

  if (person.debugSnapshot) {
    console.info('New tab visible text and DOM samples', person.debugSnapshot);
    console.table(person.debugSnapshot.familySearchPersonLinks.map((link) => ({
      personId: link.personId,
      text: link.text,
      ariaLabel: link.ariaLabel,
      href: link.href,
      context: link.context
    })));
  } else {
    console.warn('The retrieve response did not include a page debug snapshot.');
  }

  console.groupEnd();
}
