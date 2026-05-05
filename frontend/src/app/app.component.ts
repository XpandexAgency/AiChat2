import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { io, Socket } from 'socket.io-client';

interface SessionState {
  sessionId: string;
  mode: 'normal' | 'business';
  status: string;
  qrDataUrl: string | null;
  lastError: string | null;
  connectedNumber: string | null;
  updatedAt: string;
}

interface RealtimeEvent {
  direction: 'incoming' | 'outgoing';
  sessionId: string;
  from?: string;
  to?: string;
  body: string;
  timestamp: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);

  apiBaseUrl = (window as any).__API_BASE__ || 'http://localhost:3000/api';
  socketUrl = (window as any).__SOCKET_URL__ || 'http://localhost:3000';

  socket: Socket | null = null;
  sessions: SessionState[] = [];
  events: RealtimeEvent[] = [];

  newSessionId = 'bot-main';
  newSessionMode: 'normal' | 'business' = 'normal';

  sendSessionId = 'bot-main';
  sendTo = '';
  sendText = '';

  isLoading = false;
  errorMessage = '';

  ngOnInit(): void {
    this.loadSessions();
    this.connectSocket();
  }

  ngOnDestroy(): void {
    this.socket?.disconnect();
  }

  loadSessions(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.http.get<SessionState[]>(`${this.apiBaseUrl}/sessions`).subscribe({
      next: (sessions) => {
        this.sessions = sessions;
        this.isLoading = false;
      },
      error: (error) => {
        this.errorMessage = error?.error?.error || 'No se pudo cargar el backend';
        this.isLoading = false;
      },
    });
  }

  connectSocket(): void {
    this.socket = io(this.socketUrl);

    this.socket.on('sessions:init', (list: SessionState[]) => {
      this.sessions = list;
    });

    this.socket.on('session:update', (session: SessionState) => {
      const idx = this.sessions.findIndex((x) => x.sessionId === session.sessionId);
      if (idx >= 0) {
        this.sessions[idx] = session;
      } else {
        this.sessions = [...this.sessions, session];
      }
      this.sessions = [...this.sessions].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    });

    this.socket.on('session:removed', (payload: { sessionId: string; warning?: string }) => {
      this.sessions = this.sessions.filter((s) => s.sessionId !== payload.sessionId);
      if (payload.warning) {
        this.errorMessage = payload.warning;
      }
    });

    this.socket.on('message:incoming', (payload: any) => {
      this.events.unshift({
        direction: 'incoming',
        sessionId: payload.sessionId,
        from: payload.message?.from,
        body: payload.message?.body || '',
        timestamp: payload.timestamp,
      });
      this.events = this.events.slice(0, 30);
    });

    this.socket.on('message:outgoing', (payload: any) => {
      this.events.unshift({
        direction: 'outgoing',
        sessionId: payload.sessionId,
        to: payload.message?.to,
        body: payload.message?.body || '',
        timestamp: payload.timestamp,
      });
      this.events = this.events.slice(0, 30);
    });
  }

  startSession(): void {
    if (!this.newSessionId.trim()) return;

    this.http
      .post(`${this.apiBaseUrl}/sessions/start`, {
        sessionId: this.newSessionId.trim(),
        mode: this.newSessionMode,
      })
      .subscribe({
        next: () => {
          this.errorMessage = '';
          this.sendSessionId = this.newSessionId.trim();
        },
        error: (error) => {
          this.errorMessage = error?.error?.error || 'No se pudo iniciar la sesión';
        },
      });
  }

  stopSession(sessionId: string): void {
    this.http.post(`${this.apiBaseUrl}/sessions/${sessionId}/stop`, {}).subscribe({
      next: () => {
        this.errorMessage = '';
      },
      error: (error) => {
        this.errorMessage = error?.error?.error || 'No se pudo detener la sesión';
      },
    });
  }

  deleteSession(sessionId: string): void {
    const confirmed = confirm(
      `¿Eliminar la sesión "${sessionId}"? Se borrarán las credenciales y al volver a iniciarla generará un QR nuevo.`,
    );
    if (!confirmed) return;

    this.http.delete(`${this.apiBaseUrl}/sessions/${sessionId}`).subscribe({
      next: () => {
        this.errorMessage = '';
        this.sessions = this.sessions.filter((s) => s.sessionId !== sessionId);
      },
      error: (error) => {
        this.errorMessage = error?.error?.error || 'No se pudo eliminar la sesión';
      },
    });
  }

  sendMessage(): void {
    if (!this.sendSessionId.trim() || !this.sendTo.trim() || !this.sendText.trim()) return;

    this.http
      .post(`${this.apiBaseUrl}/messages/send`, {
        sessionId: this.sendSessionId.trim(),
        to: this.sendTo.trim(),
        text: this.sendText.trim(),
      })
      .subscribe({
        next: () => {
          this.errorMessage = '';
          this.sendText = '';
        },
        error: (error) => {
          this.errorMessage = error?.error?.error || 'No se pudo enviar el mensaje';
        },
      });
  }

  trackBySessionId(_index: number, session: SessionState): string {
    return session.sessionId;
  }

  statusVariant(status: string): string {
    switch (status) {
      case 'ready':
      case 'authenticated':
        return 'ok';
      case 'waiting_qr_scan':
        return 'warn';
      case 'starting':
        return 'info';
      case 'error':
      case 'auth_failure':
        return 'err';
      case 'stopped':
      case 'disconnected':
      default:
        return 'mute';
    }
  }

  statusLabel(status: string): string {
    const map: Record<string, string> = {
      starting: 'Iniciando',
      waiting_qr_scan: 'Esperando QR',
      authenticated: 'Autenticado',
      ready: 'Conectado',
      auth_failure: 'Fallo auth',
      disconnected: 'Desconectado',
      stopped: 'Detenido',
      error: 'Error',
    };
    return map[status] || status;
  }
}
