import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export interface PairingSession {
  sessionId: string;
  status: string;
  qrDataUrl: string | null;
  connectedNumber: string | null;
  lastError: string | null;
}

export interface PairingView {
  client: { id: number; name: string; isActive: boolean };
  sessions: PairingSession[];
}

@Injectable({ providedIn: 'root' })
export class PairingService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/pairing';

  fetch(token: string): Observable<PairingView> {
    return this.http.get<PairingView>(`${this.base}/${encodeURIComponent(token)}`);
  }

  startSession(token: string): Observable<PairingView> {
    return this.http.post<PairingView>(`${this.base}/${encodeURIComponent(token)}/sessions`, {});
  }
}
