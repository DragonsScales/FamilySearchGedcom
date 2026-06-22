import { Component, EventEmitter, Input, Output } from '@angular/core';
import type {
  PersonCard,
  PersonCardSectionOpenChange,
  SectionKey
} from '../../Interfaces/person-card.interface';
import { CardDropdownComponent } from '../card-dropdown/card-dropdown.component';
import {
  factsToDropdownItems,
  relatedPeopleToDropdownItems
} from '../card-dropdown/card-dropdown-items';

@Component({
  selector: 'fsg-person-card',
  standalone: true,
  imports: [CardDropdownComponent],
  templateUrl: './person-card.component.html',
  styleUrl: './person-card.component.css'
})
export class PersonCardComponent {
  readonly factsToDropdownItems = factsToDropdownItems;
  readonly relatedPeopleToDropdownItems = relatedPeopleToDropdownItems;

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
}
