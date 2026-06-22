import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import type { ChromeRuntimeReloadApi } from '../../Interfaces/chrome-runtime.interface';

declare const chrome: ChromeRuntimeReloadApi;

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
}
