export interface FamilySearchCapturedFact {
  type: string;
  values: string[];
  rawText: string;
}

export interface FamilySearchCapturedRelationship {
  personId: string;
  name: string;
  relationshipHint: string;
  url: string;
  context: string;
}

export interface FamilySearchPageDebugLink {
  text: string;
  href: string;
  personId: string | null;
  ariaLabel: string;
  role: string;
  context: string;
}

export interface FamilySearchPageDebugSnapshot {
  url: string;
  title: string;
  expectedFamilySearchId: string;
  documentReadyState: string;
  readinessReason: string;
  loadingSkeletonCount: number;
  hasExpectedFamilySearchId: boolean;
  bodyTextLength: number;
  mainTextLength: number;
  headings: string[];
  visibleTextSample: string[];
  mainTextSample: string;
  bodyTextSample: string;
  mainHtmlSample: string;
  familySearchPersonLinks: FamilySearchPageDebugLink[];
}

export interface FamilySearchRetrievedPerson {
  familySearchId: string;
  displayName: string;
  url: string;
  title: string;
  capturedAt: string;
  facts: FamilySearchCapturedFact[];
  relationships: FamilySearchCapturedRelationship[];
  debugSnapshot?: FamilySearchPageDebugSnapshot;
}
