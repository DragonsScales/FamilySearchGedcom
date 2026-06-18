import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  PersonCard,
  PersonCardSectionOpenChange,
  SectionKey
} from '../../Interfaces/person-card.interface';

@Component({
  selector: 'fsg-person-card',
  standalone: true,
  templateUrl: './person-card.component.html',
  styleUrl: './person-card.component.css'
})
export class PersonCardComponent {
  @Input({ required: true }) person!: PersonCard;
  @Input() isSelected = false;
  @Input() showStartAction = true;

  @Output() readonly selectStart = new EventEmitter<void>();
  @Output() readonly sectionOpenChange = new EventEmitter<PersonCardSectionOpenChange>();

  onSectionToggle(section: SectionKey, event: Event): void {
    this.sectionOpenChange.emit({
      section,
      open: (event.target as HTMLDetailsElement).open
    });
  }
}
