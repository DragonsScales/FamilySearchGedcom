import { Component, EventEmitter, Input, Output } from '@angular/core';
import type { CardDropdownItem } from '../../Interfaces/card-dropdown.interface';
import type {
  PersonCard,
  PersonCardSectionOpenChange,
  RelatedPersonView,
  FactView,
  SectionKey
} from '../../Interfaces/person-card.interface';
import { CardDropdownComponent } from '../card-dropdown/card-dropdown.component';

@Component({
  selector: 'fsg-person-card',
  standalone: true,
  imports: [CardDropdownComponent],
  templateUrl: './person-card.component.html',
  styleUrl: './person-card.component.css'
})
export class PersonCardComponent {
  @Input({ required: true }) person!: PersonCard;
  @Input() isSelected = false;
  @Input() showStartAction = true;

  @Output() readonly selectStart = new EventEmitter<void>();
  @Output() readonly sectionOpenChange = new EventEmitter<PersonCardSectionOpenChange>();

  onSectionOpenChange(section: SectionKey, open: boolean): void {
    this.sectionOpenChange.emit({
      section,
      open
    });
  }

  relatedDropdownItems(people: RelatedPersonView[]): CardDropdownItem[] {
    return people.map((person) => ({
      id: person.id,
      title: person.name,
      lines: []
    }));
  }

  factDropdownItems(facts: FactView[]): CardDropdownItem[] {
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
      lines: this.factLines(fact)
    }));
  }

  private factLines(fact: FactView): CardDropdownItem['lines'] {
    const lines: CardDropdownItem['lines'] = [];
    if (fact.date) lines.push({ label: 'Date', value: fact.date });
    if (fact.place) lines.push({ label: 'Place', value: fact.place });
    if (fact.value) lines.push({ label: 'Value', value: fact.value });

    for (const note of fact.notes) {
      lines.push({ label: 'Note', value: note });
    }

    return lines;
  }
}
