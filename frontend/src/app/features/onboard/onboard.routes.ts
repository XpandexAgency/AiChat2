import { Routes } from '@angular/router';

export const ONBOARD_ROUTES: Routes = [
  {
    path: ':token',
    loadComponent: () => import('./onboard.component').then((m) => m.OnboardComponent),
  },
];
