import type { NormalizedGedcomDocument } from './gedcom.interface';
import type { FamilySearchRetrievedPerson } from './familysearch-person.interface';

export interface StoredGedcomImport {
  fileName: string;
  fileSize: number;
  importedAt: string;
  document: NormalizedGedcomDocument;
}

export interface StoredStartPersonMapping {
  gedcomPersonId: string;
  familySearchId: string;
  retrievedFamilySearchPerson?: FamilySearchRetrievedPerson;
  updatedAt: string;
}
