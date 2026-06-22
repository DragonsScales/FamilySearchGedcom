import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  CardSettingKey,
  CardSettings
} from '../../Interfaces/card-settings.interface';
import type {
  FamilySearchCollectorState
} from '../../Interfaces/familysearch-collector.interface';
import type {
  CardSectionOverrides,
  PersonCard,
  SectionKey
} from '../../Interfaces/person-card.interface';
import { CardSettingsComponent } from '../card-settings/card-settings.component';
import { ExtensionStorageService } from '../extension-storage.service';
import { FamilySearchTraversalService } from '../familysearch-traversal.service';
import { normalizeFamilySearchIdInput } from '../familysearch-id';
import { buildFamilySearchPersonCards } from '../person-card/familysearch-person-card.mapper';
import { clearOverridesForSetting } from '../person-card/person-card-sections';
import { PersonCardComponent } from '../person-card/person-card.component';

const POLL_INTERVAL_MS = 3000;

@Component({
  selector: 'fsg-traversal',
  standalone: true,
  imports: [
    CardSettingsComponent,
    PersonCardComponent,
    RouterLink
  ],
  templateUrl: './traversal.component.html',
  styleUrl: './traversal.component.css'
})
export class TraversalComponent implements OnInit, OnDestroy {
  private readonly traversal = inject(FamilySearchTraversalService);
  private readonly storage = inject(ExtensionStorageService);
  private refreshIntervalId: number | null = null;
  private optionsLoaded = false;

  readonly collectorState = signal<FamilySearchCollectorState | null>(null);
  readonly mappedFamilySearchId = signal('');
  readonly loadErrorMessage = signal('');
  readonly actionErrorMessage = signal('');
  readonly actionStatusMessage = signal('');
  readonly isBusy = signal(false);
  readonly accountAccessConsent = signal(false);
  readonly maxPagesEnabled = signal(false);
  readonly maxPagesInput = signal('25');
  readonly delaySecondsInput = signal('6');
  readonly settings = signal<CardSettings>({
    relationshipsOpen: false,
    residencesOpen: false,
    otherOpen: false
  });
  readonly sectionOverrides = signal<CardSectionOverrides>({});

  readonly personCards = computed(() => {
    const state = this.collectorState();
    if (!state) return [];
    return buildFamilySearchPersonCards(
      state.records,
      this.settings(),
      this.sectionOverrides()
    );
  });
  readonly isRunning = computed(() => this.collectorState()?.running ?? false);
  readonly queuedCount = computed(() => this.collectorState()?.queue.length ?? 0);
  readonly visitedCount = computed(() => this.collectorState()?.visitedPersonIds.length ?? 0);
  readonly lastEvent = computed(() => this.collectorState()?.lastEvent ?? 'Idle');

  async ngOnInit(): Promise<void> {
    await this.loadTraversalContext();
    this.refreshIntervalId = window.setInterval(() => {
      if (this.isRunning()) void this.refreshTraversalState({ silent: true });
    }, POLL_INTERVAL_MS);
  }

  ngOnDestroy(): void {
    if (this.refreshIntervalId !== null) window.clearInterval(this.refreshIntervalId);
  }

  async loadTraversalContext(): Promise<void> {
    await Promise.all([
      this.loadMappedFamilySearchId(),
      this.refreshTraversalState({ silent: true })
    ]);
  }

  async refreshTraversalState(options: { silent?: boolean } = {}): Promise<void> {
    if (!options.silent) this.actionStatusMessage.set('Refreshing FamilySearch traversal state.');

    try {
      const state = await this.traversal.getState();
      this.collectorState.set(state);
      this.loadOptionsFromState(state);
      this.loadErrorMessage.set('');
      if (!options.silent) this.actionStatusMessage.set('FamilySearch traversal state refreshed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load FamilySearch traversal state.';
      this.loadErrorMessage.set(message);
      if (!options.silent) this.actionErrorMessage.set(message);
    }
  }

  async startTraversal(): Promise<void> {
    const familySearchId = this.mappedFamilySearchId();
    if (!familySearchId) {
      this.actionErrorMessage.set('Save a FamilySearch starting person in Mapping before starting traversal.');
      return;
    }

    if (!this.accountAccessConsent()) {
      this.actionErrorMessage.set('Confirm FamilySearch account access before starting traversal.');
      return;
    }

    this.isBusy.set(true);
    this.actionErrorMessage.set('');
    this.actionStatusMessage.set(`Starting FamilySearch traversal from ${familySearchId}.`);

    try {
      const state = await this.traversal.startTraversal({
        familySearchId,
        accountAccessConsent: this.accountAccessConsent(),
        maxPagesEnabled: this.maxPagesEnabled(),
        maxPages: parsePositiveInteger(this.maxPagesInput(), 25),
        delayMs: parseDelaySeconds(this.delaySecondsInput(), 6)
      });
      this.collectorState.set(state);
      this.actionStatusMessage.set(state.lastEvent);
    } catch (error) {
      this.actionErrorMessage.set(error instanceof Error ? error.message : 'Could not start FamilySearch traversal.');
      this.actionStatusMessage.set('');
    } finally {
      this.isBusy.set(false);
    }
  }

  async stopTraversal(): Promise<void> {
    this.isBusy.set(true);
    this.actionErrorMessage.set('');
    this.actionStatusMessage.set('Stopping FamilySearch traversal.');

    try {
      const state = await this.traversal.stopTraversal();
      this.collectorState.set(state);
      this.actionStatusMessage.set(state.lastEvent);
    } catch (error) {
      this.actionErrorMessage.set(error instanceof Error ? error.message : 'Could not stop FamilySearch traversal.');
      this.actionStatusMessage.set('');
    } finally {
      this.isBusy.set(false);
    }
  }

  async resetTraversal(): Promise<void> {
    this.isBusy.set(true);
    this.actionErrorMessage.set('');
    this.actionStatusMessage.set('Resetting FamilySearch traversal.');

    try {
      const state = await this.traversal.resetTraversal();
      this.collectorState.set(state);
      this.optionsLoaded = false;
      this.loadOptionsFromState(state);
      this.sectionOverrides.set({});
      this.actionStatusMessage.set(state.lastEvent);
    } catch (error) {
      this.actionErrorMessage.set(error instanceof Error ? error.message : 'Could not reset FamilySearch traversal.');
      this.actionStatusMessage.set('');
    } finally {
      this.isBusy.set(false);
    }
  }

  setMaxPages(event: Event): void {
    this.maxPagesInput.set((event.target as HTMLInputElement).value);
  }

  setMaxPagesEnabled(event: Event): void {
    this.maxPagesEnabled.set((event.target as HTMLInputElement).checked);
  }

  setDelaySeconds(event: Event): void {
    this.delaySecondsInput.set((event.target as HTMLInputElement).value);
  }

  setAccountAccessConsent(event: Event): void {
    this.accountAccessConsent.set((event.target as HTMLInputElement).checked);
    this.actionErrorMessage.set('');
  }

  setDefaultOpen(setting: CardSettingKey, open: boolean): void {
    this.settings.update((settings) => ({
      ...settings,
      [setting]: open
    }));

    this.sectionOverrides.update((overrides) => clearOverridesForSetting(overrides, setting));
  }

  setSectionOpen(card: PersonCard, section: SectionKey, open: boolean): void {
    this.sectionOverrides.update((overrides) => ({
      ...overrides,
      [card.id]: {
        ...overrides[card.id],
        [section]: open
      }
    }));
  }

  private async loadMappedFamilySearchId(): Promise<void> {
    try {
      const mapping = await this.storage.getStartPersonMapping();
      this.mappedFamilySearchId.set(mapping?.familySearchId ? normalizeFamilySearchIdInput(mapping.familySearchId) : '');
    } catch (error) {
      this.loadErrorMessage.set(error instanceof Error ? error.message : 'Could not load the saved FamilySearch mapping.');
    }
  }

  private loadOptionsFromState(state: FamilySearchCollectorState): void {
    if (this.optionsLoaded) return;

    this.maxPagesInput.set(String(state.options.maxPages));
    this.maxPagesEnabled.set(state.options.maxPagesEnabled);
    this.delaySecondsInput.set(formatSeconds(state.options.delayMs));
    this.optionsLoaded = true;
  }
}

function parsePositiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseDelaySeconds(value: string, fallbackSeconds: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 1000)
    : fallbackSeconds * 1000;
}

function formatSeconds(delayMs: number): string {
  const seconds = delayMs / 1000;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}
