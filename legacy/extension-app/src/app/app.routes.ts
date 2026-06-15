import { Routes } from '@angular/router';
import { GedcomUploadComponent } from './gedcom-upload/gedcom-upload.component';
import { GedcomResultsComponent } from './gedcom-results/gedcom-results.component';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'gedcom',
    pathMatch: 'full'
  },
  {
    path: 'gedcom',
    component: GedcomUploadComponent
  },
  {
    path: 'results',
    component: GedcomResultsComponent
  },
  {
    path: '**',
    redirectTo: 'gedcom'
  }
];
