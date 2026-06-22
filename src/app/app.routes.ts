import { Routes } from '@angular/router';
import { GedcomUploadComponent } from './gedcom-upload/gedcom-upload.component';
import { GedcomResultsComponent } from './gedcom-results/gedcom-results.component';
import { MappingComponent } from './mapping/mapping.component';
import { TraversalComponent } from './traversal/traversal.component';
import { CompareComponent } from './compare/compare.component';

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
    path: 'mapping',
    component: MappingComponent
  },
  {
    path: 'traversal',
    component: TraversalComponent
  },
  {
    path: 'compare',
    component: CompareComponent
  },
  {
    path: '**',
    redirectTo: 'gedcom'
  }
];
