export interface CardDropdownLine {
  label: string;
  value: string;
}

export interface CardDropdownItem {
  id: string;
  title: string;
  lines: CardDropdownLine[];
}
