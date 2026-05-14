import { Routes } from '@angular/router';

export const CLIENTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./clients-list.component').then((m) => m.ClientsListComponent),
  },
  {
    path: 'new',
    loadComponent: () => import('./client-form.component').then((m) => m.ClientFormComponent),
  },
  {
    path: ':id/edit',
    loadComponent: () => import('./client-form.component').then((m) => m.ClientFormComponent),
  },
  {
    path: ':id',
    loadComponent: () => import('./client-detail.component').then((m) => m.ClientDetailComponent),
  },
];
