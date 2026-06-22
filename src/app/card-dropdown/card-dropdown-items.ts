import type { CardDropdownItem } from '../../Interfaces/card-dropdown.interface';
import type {
  FactView,
  RelatedPersonView
} from '../../Interfaces/person-card.interface';

const EMPTY_VALUE = 'Not listed';

export function relatedPeopleToDropdownItems(people: RelatedPersonView[]): CardDropdownItem[] {
  return people.map((person) => ({
    id: person.id,
    title: person.name,
    lines: []
  }));
}

export function factsToDropdownItems(facts: FactView[]): CardDropdownItem[] {
  return facts.map((fact, index) => ({
    id: [
      index,
      fact.type,
      fact.date ?? '',
      fact.place ?? '',
      fact.value ?? '',
      fact.notes.join('|')
    ].join(':'),
    title: fact.label,
    lines: factLines(fact)
  }));
}

export function textToDropdownItems(value: string): CardDropdownItem[] {
  if (value === EMPTY_VALUE) return [];

  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: `${index}:${line}`,
      title: line,
      lines: []
    }));
}

function factLines(fact: FactView): CardDropdownItem['lines'] {
  const lines: CardDropdownItem['lines'] = [];
  if (fact.date) lines.push({ label: 'Date', value: fact.date });
  if (fact.place) lines.push({ label: 'Place', value: fact.place });
  if (fact.value) lines.push({ label: 'Value', value: fact.value });

  for (const note of fact.notes) {
    lines.push({ label: 'Note', value: note });
  }

  return lines;
}
