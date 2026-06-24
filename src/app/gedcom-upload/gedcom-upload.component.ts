import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { StoredGedcomImport } from '../../Interfaces/storage.interface';
import { ExtensionStorageService } from '../extension-storage.service';
import { parseGedcomText } from './gedcom-parser';

@Component({
  selector: 'fsg-gedcom-upload',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './gedcom-upload.component.html',
  styleUrl: './gedcom-upload.component.css'
})
export class GedcomUploadComponent implements OnInit {
  private readonly storage = inject(ExtensionStorageService);
  private readonly router = inject(Router);

  readonly importedGedcom = signal<StoredGedcomImport | null>(null);
  readonly errorMessage = signal('');
  readonly isParsing = signal(false);
  readonly uploadLabel = computed(() => {
    if (this.isParsing()) return 'Parsing...';
    if (this.importedGedcom()) return 'Parsed';
    return 'Select GEDCOM';
  });

  async ngOnInit(): Promise<void> {
    this.importedGedcom.set(await this.storage.getGedcomImport());
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.errorMessage.set('');
    this.isParsing.set(true);

    try {
      const text = await file.text();
      const document = parseGedcomText(text);
      const importedGedcom: StoredGedcomImport = {
        fileName: file.name,
        fileSize: file.size,
        importedAt: new Date().toISOString(),
        document
      };

      await this.storage.replaceGedcomImport(importedGedcom);
      this.importedGedcom.set(importedGedcom);
      await this.router.navigate(['/results']);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Could not parse this GEDCOM file.');
    } finally {
      this.isParsing.set(false);
      input.value = '';
    }
  }

  async clearGedcom(): Promise<void> {
    await this.storage.clearGedcomImport();
    this.importedGedcom.set(null);
    this.errorMessage.set('');
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
