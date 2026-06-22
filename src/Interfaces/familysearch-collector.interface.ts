import type {
  FamilySearchCapturedFact,
  FamilySearchCapturedRelationship,
  FamilySearchPageDebugSnapshot
} from './familysearch-person.interface';

export interface FamilySearchCollectorOptions {
  maxPages: number;
  maxPagesEnabled: boolean;
  allowedIds: string[];
}

export interface FamilySearchTraversalQueueItem {
  personId: string;
  gedcomPersonId: string;
  name: string;
  relationshipHint: string;
  fromPersonId: string | null;
  fromGedcomPersonId: string | null;
  depth: number;
  url: string;
  branch: 'root' | 'ancestor' | 'descendant';
  matchNote?: string;
}

export interface FamilySearchTraversalMetadata {
  source: string;
  depth: number;
  fromPersonId: string | null;
  gedcomPersonId?: string | null;
  fromGedcomPersonId?: string | null;
  relationshipHint: string | null;
  branch?: 'root' | 'ancestor' | 'descendant';
  matchStatus?: 'matched' | 'missing' | 'ambiguous';
  matchNote?: string;
}

export interface FamilySearchCaptureRecord {
  schemaVersion?: number;
  source?: string;
  capturedAt?: string;
  url?: string;
  title?: string;
  person?: {
    familySearchId?: string | null;
    displayName?: string;
  };
  facts?: FamilySearchCapturedFact[];
  relationships?: FamilySearchCapturedRelationship[];
  raw?: FamilySearchPageDebugSnapshot;
  traversal?: FamilySearchTraversalMetadata;
  [key: string]: unknown;
}

export interface FamilySearchCollectorState {
  running: boolean;
  activeTabId: number | null;
  activeItem: FamilySearchTraversalQueueItem | null;
  queue: FamilySearchTraversalQueueItem[];
  visitedPersonIds: string[];
  records: FamilySearchCaptureRecord[];
  options: FamilySearchCollectorOptions;
  lastEvent: string;
  updatedAt: string;
}

export interface FamilySearchTraversalStartOptions {
  familySearchId?: string;
  accountAccessConsent: boolean;
  maxPages: number;
  maxPagesEnabled: boolean;
  resume?: boolean;
}
