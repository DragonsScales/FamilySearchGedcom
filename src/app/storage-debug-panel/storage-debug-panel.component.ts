import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'fsg-storage-debug-panel',
  standalone: true,
  templateUrl: './storage-debug-panel.component.html',
  styleUrl: './storage-debug-panel.component.css'
})
export class StorageDebugPanelComponent {
  @Input() lastRefresh = '';
  @Input() typedImportSummary = '';
  @Input() rawStorageJson = '';

  @Output() readonly refresh = new EventEmitter<void>();
}
