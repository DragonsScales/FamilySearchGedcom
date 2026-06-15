export interface GedcomDocument {
  metadata: {
    source?: string;
    version?: string;
    charset?: string;
    importedAt: string;
  };
  people: GedcomPerson[];
  families: GedcomFamily[];
}

export interface GedcomPerson {
  id: string;
  names: GedcomName[];
  sex?: string;
  facts: GedcomFact[];
  parentFamilyIds: string[];
  spouseFamilyIds: string[];
  relationships: GedcomPersonRelationships;
}

export interface GedcomName {
  full: string;
  given?: string;
  surname?: string;
}

export interface GedcomFact {
  type: string;
  date?: string;
  place?: string;
  value?: string;
  notes: string[];
}

export interface GedcomPersonRelationships {
  parents: string[];
  spouses: string[];
  children: string[];
  siblings: string[];
}

export interface GedcomFamily {
  id: string;
  husbandId?: string;
  wifeId?: string;
  childIds: string[];
  facts: GedcomFact[];
}

export interface GedcomNode {
  level: number;
  tag: string;
  pointer?: string;
  value?: string;
  children: GedcomNode[];
}
