import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import type {
  ChromeRuntimeMessageApi,
  ChromeRuntimeMessageResponse,
  ChromeRuntimeReloadApi
} from '../../Interfaces/chrome-runtime.interface';

declare const chrome: ChromeRuntimeReloadApi & ChromeRuntimeMessageApi;

const FAMILYSEARCH_DUMP_URL = 'https://www.familysearch.org/en/tree/person/details/KWC2-W3K';

@Component({
  selector: 'fsg-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './nav.component.html',
  styleUrl: './nav.component.css'
})
export class NavComponent {
  reloadExtension(): void {
    if (typeof chrome !== 'undefined' && chrome.runtime?.reload) {
      chrome.runtime.reload();
    }
  }

  logPageDump(): void {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;

    void new Promise<ChromeRuntimeMessageResponse>((resolve, reject) => {
      chrome.runtime!.sendMessage(
        { type: 'DUMP_PAGE_FROM_URL', payload: { url: FAMILYSEARCH_DUMP_URL } },
        (response) => {
          const errorMessage = chrome.runtime?.lastError?.message;
          if (errorMessage) {
            reject(new Error(errorMessage));
            return;
          }

          if (response && typeof response === 'object' && 'ok' in response) {
            resolve(response as ChromeRuntimeMessageResponse);
            return;
          }

          reject(new Error('The extension returned an invalid message response.'));
        }
      );
    }).then((response) => {
      if (!response.ok || !response.result || typeof response.result !== 'object') return;

      console.log('FamilySearch page dump', response.result);
    }).catch((error: unknown) => {
      console.error('Could not dump the FamilySearch page.', error);
    }).finally(() => {
      console.log("Finished running");
    })
  }
}
