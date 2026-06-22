import { Component, EventEmitter, Input, Output } from '@angular/core';
import type {
  CardDropdownBadge,
  CardDropdownItem,
  CardDropdownLine
} from '../../Interfaces/card-dropdown.interface';

@Component({
  selector: 'fsg-card-dropdown',
  standalone: true,
  templateUrl: './card-dropdown.component.html',
  styleUrl: './card-dropdown.component.css'
})
export class CardDropdownComponent {
  @Input({ required: true }) title = '';
  @Input() items: readonly CardDropdownItem[] = [];
  @Input() open = false;
  @Input() emptyText = 'Not listed';
  @Input() badge: CardDropdownBadge | null = null;

  @Output() readonly openChange = new EventEmitter<boolean>();

  get hasDetailedItems(): boolean {
    return this.items.some((item) => item.lines.length > 0);
  }

  onToggle(event: Event): void {
    this.openChange.emit((event.target as HTMLDetailsElement).open);
  }

  trackItem(_index: number, item: CardDropdownItem): string {
    return item.id;
  }

  trackLine(index: number, line: CardDropdownLine): string {
    return `${index}:${line.label}:${line.value}`;
  }
}
