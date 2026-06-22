export type CardDropdownBadgeSource = 'same' | 'new' | 'review' | 'missing' | 'empty';

export interface CardDropdownBadge {
  source: CardDropdownBadgeSource;
  label: string;
}

export interface CardDropdownLine {
  label: string;
  value: string;
}

export interface CardDropdownItem {
  id: string;
  title: string;
  lines: CardDropdownLine[];
}
