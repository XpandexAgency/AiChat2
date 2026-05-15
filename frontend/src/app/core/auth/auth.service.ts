import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap } from 'rxjs';

export interface AdminProfile {
  id: number;
  email: string;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/admin/auth';

  private readonly _admin = signal<AdminProfile | null>(null);
  private readonly _checked = signal(false);

  readonly admin = this._admin.asReadonly();
  readonly isAuthenticated = computed(() => this._admin() !== null);
  readonly checked = this._checked.asReadonly();

  // Llamar al inicio de la app: comprueba si ya hay sesión válida vía cookie.
  hydrate(): Observable<AdminProfile | null> {
    return this.http.get<AdminProfile>(`${this.base}/me`).pipe(
      tap((admin) => {
        this._admin.set(admin);
        this._checked.set(true);
      }),
      catchError(() => {
        this._admin.set(null);
        this._checked.set(true);
        return of(null);
      }),
    );
  }

  login(email: string, password: string): Observable<AdminProfile> {
    return this.http.post<{ ok: boolean; admin: AdminProfile }>(
      `${this.base}/login`,
      { email, password },
    ).pipe(
      map((res) => res.admin),
      tap((admin) => this._admin.set(admin)),
    );
  }

  logout(): Observable<unknown> {
    return this.http.post(`${this.base}/logout`, {}).pipe(
      tap(() => this._admin.set(null)),
      catchError(() => {
        // Forzar limpieza local aunque falle el backend
        this._admin.set(null);
        return of(null);
      }),
    );
  }
}
