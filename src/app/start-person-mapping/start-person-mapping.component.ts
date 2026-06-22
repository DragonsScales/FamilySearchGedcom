import { Component, EventEmitter, Input, Output } from '@angular/core';
import { normalizeFamilySearchIdInput } from '../familysearch-id';
import type { PersonCard } from '../../Interfaces/person-card.interface';

@Component({
  selector: 'fsg-start-person-mapping',
  standalone: true,
  templateUrl: './start-person-mapping.component.html',
  styleUrl: './start-person-mapping.component.css'
})
export class StartPersonMappingComponent {
  @Input() startPerson: PersonCard | null = null;
  @Input() familySearchId = '';
  @Input() isFamilySearchIdComplete = false;
  @Input() isRetrievingPerson = false;
  @Input() accountAccessConsent = false;
  @Input() errorMessage = '';
  @Input() statusMessage = '';

  @Output() readonly familySearchIdChange = new EventEmitter<string>();
  @Output() readonly accountAccessConsentChange = new EventEmitter<boolean>();
  @Output() readonly retrievePerson = new EventEmitter<void>();
  @Output() readonly clearMapping = new EventEmitter<void>();

  onFamilySearchIdInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const formatted = normalizeFamilySearchIdInput(input.value);
    input.value = formatted;
    this.familySearchIdChange.emit(formatted);
  }

  onAccountAccessConsentChange(event: Event): void {
    this.accountAccessConsentChange.emit((event.target as HTMLInputElement).checked);
  }
}
