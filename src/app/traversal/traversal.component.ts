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
  private unsubscribeTraversalState: (() => void) | null = null;

  readonly collectorState = signal<FamilySearchCollectorState | null>(null);
  readonly mappedFamilySearchId = signal('');
  readonly loadErrorMessage = signal('');
  readonly actionErrorMessage = signal('');
  readonly actionStatusMessage = signal('');
  readonly isBusy = signal(false);
  readonly accountAccessConsent = signal(false);
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
  readonly hasReusableTraversalData = computed(() => {
    const state = this.collectorState();
    return Boolean(state && (
      state.records.length > 0 ||
      state.queue.length > 0 ||
      state.visitedPersonIds.length > 0 ||
      state.activeItem
    ));
  });

  async ngOnInit(): Promise<void> {
    this.watchTraversalState();
    await this.loadTraversalContext();
  }

  ngOnDestroy(): void {
    this.unsubscribeTraversalState?.();
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
      this.loadErrorMessage.set('');
      if (!options.silent) this.actionStatusMessage.set('FamilySearch traversal state refreshed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load FamilySearch traversal state.';
      this.loadErrorMessage.set(message);
      if (!options.silent) this.actionErrorMessage.set(message);
    }
  }

  async startTraversal(): Promise<void> {
    await this.runTraversal('start');
  }

  async resumeTraversal(): Promise<void> {
    await this.runTraversal('resume');
  }

  private async runTraversal(mode: 'start' | 'resume'): Promise<void> {
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
    this.actionStatusMessage.set(
      `${mode === 'resume' ? 'Resuming' : 'Starting'} FamilySearch traversal from ${familySearchId}.`
    );

    try {
      const options = {
        familySearchId,
        accountAccessConsent: this.accountAccessConsent()
      };
      const state = mode === 'resume'
        ? await this.traversal.resumeTraversal(options)
        : await this.traversal.startTraversal(options);
      this.collectorState.set(state);
      this.actionStatusMessage.set(state.lastEvent);
    } catch (error) {
      this.actionErrorMessage.set(error instanceof Error
        ? error.message
        : `Could not ${mode === 'resume' ? 'resume' : 'start'} FamilySearch traversal.`);
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
      this.sectionOverrides.set({});
      this.actionStatusMessage.set(state.lastEvent);
    } catch (error) {
      this.actionErrorMessage.set(error instanceof Error ? error.message : 'Could not reset FamilySearch traversal.');
      this.actionStatusMessage.set('');
    } finally {
      this.isBusy.set(false);
    }
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

  private watchTraversalState(): void {
    this.unsubscribeTraversalState = this.traversal.watchState((state) => {
      this.collectorState.set(state);
      this.loadErrorMessage.set('');
    });
  }
}
