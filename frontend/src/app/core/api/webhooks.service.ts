import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class WebhooksService {
  private readonly http = inject(HttpClient);

  test(clientId: number): Observable<{ ok: boolean; status: number }> {
    return this.http.post<{ ok: boolean; status: number }>(
      `/api/webhooks/${clientId}/test`,
      {},
    );
  }
}
