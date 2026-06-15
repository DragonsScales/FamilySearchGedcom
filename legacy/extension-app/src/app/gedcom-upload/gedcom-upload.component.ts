import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ExtensionStorageService, StoredGedcomImport } from '../extension-storage.service';
import { parseGedcomText } from './gedcom-parser';

@Component({
  selector: 'fsg-gedcom-upload',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './gedcom-upload.component.html',
  styleUrl: './gedcom-upload.component.css'
})
export class GedcomUploadComponent implements OnInit {
  private readonly storage = inject(ExtensionStorageService);

  importedGedcom: StoredGedcomImport | null = null;
  errorMessage = '';
  isParsing = false;

  async ngOnInit(): Promise<void> {
    this.importedGedcom = await this.storage.getGedcomImport();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.errorMessage = '';
    this.isParsing = true;

    try {
      const text = await file.text();
      const document = parseGedcomText(text);
      const importedGedcom: StoredGedcomImport = {
        fileName: file.name,
        fileSize: file.size,
        importedAt: new Date().toISOString(),
        document
      };

      await this.storage.saveGedcomImport(importedGedcom);
      this.importedGedcom = importedGedcom;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Could not parse this GEDCOM file.';
    } finally {
      this.isParsing = false;
      input.value = '';
    }
  }

  async clearGedcom(): Promise<void> {
    await this.storage.clearGedcomImport();
    this.importedGedcom = null;
    this.errorMessage = '';
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
