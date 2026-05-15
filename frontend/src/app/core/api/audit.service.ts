import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface AuditLogEntry {
  id: number;
  admin_id: number | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: any;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditFilters {
  adminId?: number | null;
  action?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AuditService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/audit';

  list(filters: AuditFilters = {}): Observable<AuditLogEntry[]> {
    let params = new HttpParams();
    if (filters.adminId) params = params.set('adminId', String(filters.adminId));
    if (filters.action) params = params.set('action', filters.action);
    if (filters.startDate) params = params.set('startDate', filters.startDate);
    if (filters.endDate) params = params.set('endDate', filters.endDate);
    return this.http.get<AuditLogEntry[]>(this.base, { params });
  }
}
