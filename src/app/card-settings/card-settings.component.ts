import { Component, EventEmitter, Input, Output } from '@angular/core';
import type {
  CardSettingChange,
  CardSettingKey,
  CardSettings
} from '../../Interfaces/card-settings.interface';

@Component({
  selector: 'fsg-card-settings',
  standalone: true,
  templateUrl: './card-settings.component.html',
  styleUrl: './card-settings.component.css'
})
export class CardSettingsComponent {
  @Input({ required: true }) settings!: CardSettings;

  @Output() readonly settingChange = new EventEmitter<CardSettingChange>();

  onSettingChange(setting: CardSettingKey, event: Event): void {
    this.settingChange.emit({
      setting,
      open: (event.target as HTMLInputElement).checked
    });
  }
}
