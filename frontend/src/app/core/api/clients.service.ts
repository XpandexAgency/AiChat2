import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface Client {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  description: string | null;
  isActive: boolean;
  tags: string[];
  webhookIncomingUrl: string | null;
  webhookSecretConfigured: boolean;
  pairingToken: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientInput {
  name?: string;
  email?: string | null;
  phone?: string | null;
  description?: string | null;
  isActive?: boolean;
  tags?: string[];
  webhookIncomingUrl?: string | null;
  webhookSecret?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ClientsService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/clients';

  list(activeOnly = false): Observable<Client[]> {
    let params = new HttpParams();
    if (activeOnly) params = params.set('active', '1');
    return this.http.get<Client[]>(this.base, { params });
  }

  get(id: number): Observable<Client> {
    return this.http.get<Client>(`${this.base}/${id}`);
  }

  create(input: ClientInput): Observable<Client> {
    return this.http.post<Client>(this.base, input);
  }

  update(id: number, input: ClientInput): Observable<Client> {
    return this.http.put<Client>(`${this.base}/${id}`, input);
  }

  remove(id: number): Observable<{ ok: boolean; sessionsDropped: number }> {
    return this.http.delete<{ ok: boolean; sessionsDropped: number }>(`${this.base}/${id}`);
  }

  sessions(id: number): Observable<any[]> {
    return this.http.get<any[]>(`${this.base}/${id}/sessions`);
  }

  regeneratePairing(id: number): Observable<Client> {
    return this.http.post<Client>(`${this.base}/${id}/pairing/regenerate`, {});
  }
}
