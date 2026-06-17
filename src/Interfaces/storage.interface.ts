import type { NormalizedGedcomDocument } from './gedcom.interface';

export interface StoredGedcomImport {
  fileName: string;
  fileSize: number;
  importedAt: string;
  document: NormalizedGedcomDocument;
}

export interface StoredStartPersonMapping {
  gedcomPersonId: string;
  familySearchId: string;
  updatedAt: string;
}
