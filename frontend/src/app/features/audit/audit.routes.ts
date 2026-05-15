import { Routes } from '@angular/router';

export const AUDIT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./audit-log.component').then((m) => m.AuditLogComponent),
  },
];
