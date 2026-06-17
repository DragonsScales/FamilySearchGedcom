export interface NormalizedGedcomDocument {
  metadata: NormalizedGedcomMetadata;
  people: NormalizedGedcomPerson[];
  families: NormalizedGedcomFamily[];
}

export interface NormalizedGedcomMetadata {
  source?: string;
  version?: string;
  charset?: string;
  importedAt: string;
}

export interface NormalizedGedcomPerson {
  id: string;
  names: NormalizedGedcomName[];
  sex?: string;
  facts: NormalizedGedcomFact[];
  parentFamilyIds: string[];
  spouseFamilyIds: string[];
  relationships: NormalizedGedcomRelationships;
}

export interface NormalizedGedcomName {
  full: string;
  given?: string;
  surname?: string;
}

export interface NormalizedGedcomRelationships {
  parents: string[];
  spouses: string[];
  children: string[];
  siblings: string[];
}

export interface NormalizedGedcomFamily {
  id: string;
  husbandId?: string;
  wifeId?: string;
  childIds: string[];
  facts: NormalizedGedcomFact[];
}

export interface NormalizedGedcomFact {
  type: string;
  date?: string;
  place?: string;
  value?: string;
  notes: string[];
}
