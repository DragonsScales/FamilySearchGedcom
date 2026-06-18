export interface RelatedPersonView {
  id: string;
  name: string;
}

export interface FactView {
  type: string;
  label: string;
  date?: string;
  place?: string;
  value?: string;
  notes: string[];
}

export type SectionKey = 'parentsOpen' | 'childrenOpen' | 'siblingsOpen' | 'residencesOpen' | 'otherOpen';

export interface CardSections {
  parentsOpen: boolean;
  childrenOpen: boolean;
  siblingsOpen: boolean;
  residencesOpen: boolean;
  otherOpen: boolean;
}

export interface CardSectionOverrides {
  [personId: string]: Partial<CardSections>;
}

export interface PersonCard {
  id: string;
  referenceLabel?: string;
  referenceId?: string;
  name: string;
  gender: string;
  alternateNames: string[];
  birth?: FactView;
  death?: FactView;
  christening?: FactView;
  burial?: FactView;
  parents: RelatedPersonView[];
  children: RelatedPersonView[];
  siblings: RelatedPersonView[];
  residences: FactView[];
  otherFacts: FactView[];
  sections: CardSections;
}

export interface PersonCardSectionOpenChange {
  section: SectionKey;
  open: boolean;
}
