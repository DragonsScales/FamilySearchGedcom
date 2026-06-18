import type {
  FamilySearchCapturedFact,
  FamilySearchCapturedRelationship,
  FamilySearchPageDebugSnapshot
} from './familysearch-person.interface';

export interface FamilySearchCollectorOptions {
  maxPages: number;
  maxDepth: number;
  delayMs: number;
  allowedIds: string[];
}

export interface FamilySearchTraversalQueueItem {
  personId: string;
  name: string;
  relationshipHint: string;
  fromPersonId: string | null;
  depth: number;
  url: string;
}

export interface FamilySearchTraversalMetadata {
  source: string;
  depth: number;
  fromPersonId: string | null;
  relationshipHint: string | null;
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
  maxDepth: number;
  delayMs: number;
}
