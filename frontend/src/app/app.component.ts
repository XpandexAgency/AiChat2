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

interface ErrorLogEntry {
  timestamp: string;
  source: string;
  message: string;
  sessionId?: string;
}

interface WebhookConfig {
  incomingUrl: string;
  secretConfigured: boolean;
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
  errorLogs: ErrorLogEntry[] = [];

  newSessionId = 'bot-main';
  newSessionMode: 'normal' | 'business' = 'normal';

  sendSessionId = 'bot-main';
  sendTo = '';
  sendText = '';
  webhookIncomingUrl = '';
  webhookSecret = '';
  webhookSecretConfigured = false;

  isLoading = false;
  isWebhookSaving = false;
  isWebhookTesting = false;
  errorMessage = '';
  private readonly maxErrorLogs = 120;
  private readonly lastSessionErrorById = new Map<string, string>();
  private readonly globalErrorHandler = (event: ErrorEvent) => {
    const msg = event.message || event.error?.message || 'Error de frontend no controlado';
    this.addErrorLog('frontend:error', msg);
  };
  private readonly globalRejectionHandler = (event: PromiseRejectionEvent) => {
    const reason = this.errorToMessage(event.reason, 'Promise rechazada sin detalle');
    this.addErrorLog('frontend:unhandledrejection', reason);
  };

  ngOnInit(): void {
    window.addEventListener('error', this.globalErrorHandler);
    window.addEventListener('unhandledrejection', this.globalRejectionHandler);
    this.loadWebhookConfig();
    this.loadSessions();
    this.connectSocket();
  }

  ngOnDestroy(): void {
    this.socket?.disconnect();
    window.removeEventListener('error', this.globalErrorHandler);
    window.removeEventListener('unhandledrejection', this.globalRejectionHandler);
  }

  loadSessions(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.http.get<SessionState[]>(`${this.apiBaseUrl}/sessions`).subscribe({
      next: (sessions) => {
        this.sessions = sessions;
        this.rebuildSessionErrorState(sessions);
        this.isLoading = false;
      },
      error: (error) => {
        this.reportError('api:sessions', error, 'No se pudo cargar el backend');
        this.isLoading = false;
      },
    });
  }

  loadWebhookConfig(): void {
    this.http.get<WebhookConfig>(`${this.apiBaseUrl}/webhook-config`).subscribe({
      next: (config) => {
        this.webhookIncomingUrl = config.incomingUrl || '';
        this.webhookSecret = '';
        this.webhookSecretConfigured = Boolean(config.secretConfigured);
      },
      error: (error) => {
        this.reportError('api:webhook-config:get', error, 'No se pudo cargar configuración de webhook');
      },
    });
  }

  connectSocket(): void {
    this.socket = io(this.socketUrl);

    this.socket.on('sessions:init', (list: SessionState[]) => {
      this.sessions = list;
      this.rebuildSessionErrorState(list);
    });

    this.socket.on('session:update', (session: SessionState) => {
      const idx = this.sessions.findIndex((x) => x.sessionId === session.sessionId);
      const previous = this.lastSessionErrorById.get(session.sessionId) || '';
      const current = session.lastError || '';

      if (idx >= 0) {
        this.sessions[idx] = session;
      } else {
        this.sessions = [...this.sessions, session];
      }
      this.sessions = [...this.sessions].sort((a, b) => a.sessionId.localeCompare(b.sessionId));

      if (current && current !== previous) {
        this.addErrorLog('session:update', current, session.sessionId);
      }
      if (current) {
        this.lastSessionErrorById.set(session.sessionId, current);
      } else {
        this.lastSessionErrorById.delete(session.sessionId);
      }
    });

    this.socket.on('session:removed', (payload: { sessionId: string; warning?: string }) => {
      this.sessions = this.sessions.filter((s) => s.sessionId !== payload.sessionId);
      this.lastSessionErrorById.delete(payload.sessionId);
      if (payload.warning) {
        this.errorMessage = payload.warning;
        this.addErrorLog('session:removed', payload.warning, payload.sessionId);
      }
    });

    this.socket.on('connect_error', (error) => {
      const msg = this.errorToMessage(error, 'No se pudo conectar el socket');
      this.addErrorLog('socket:connect_error', msg);
    });

    this.socket.on('disconnect', (reason) => {
      this.addErrorLog('socket:disconnect', `Socket desconectado: ${reason}`);
    });

    this.socket.on('error', (error) => {
      const msg = this.errorToMessage(error, 'Error genérico de socket');
      this.addErrorLog('socket:error', msg);
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
          this.reportError('api:sessions/start', error, 'No se pudo iniciar la sesión', this.newSessionId.trim());
        },
      });
  }

  stopSession(sessionId: string): void {
    this.http.post(`${this.apiBaseUrl}/sessions/${sessionId}/stop`, {}).subscribe({
      next: () => {
        this.errorMessage = '';
      },
      error: (error) => {
        this.reportError('api:sessions/stop', error, 'No se pudo detener la sesión', sessionId);
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
        this.lastSessionErrorById.delete(sessionId);
      },
      error: (error) => {
        this.reportError('api:sessions/delete', error, 'No se pudo eliminar la sesión', sessionId);
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
          this.reportError('api:messages/send', error, 'No se pudo enviar el mensaje', this.sendSessionId.trim());
        },
      });
  }

  saveWebhookConfig(): void {
    this.isWebhookSaving = true;

    this.http
      .put<{ ok: boolean; config: WebhookConfig }>(`${this.apiBaseUrl}/webhook-config`, {
        incomingUrl: this.webhookIncomingUrl.trim(),
        secret: this.webhookSecret.trim(),
      })
      .subscribe({
        next: (response) => {
          this.isWebhookSaving = false;
          this.errorMessage = '';
          this.webhookSecret = '';
          this.webhookSecretConfigured = Boolean(response?.config?.secretConfigured);
        },
        error: (error) => {
          this.isWebhookSaving = false;
          this.reportError('api:webhook-config:put', error, 'No se pudo guardar configuración webhook');
        },
      });
  }

  testWebhookConfig(): void {
    this.isWebhookTesting = true;

    this.http
      .post<{ ok: boolean; status: number }>(`${this.apiBaseUrl}/webhook-config/test`, {
        incomingUrl: this.webhookIncomingUrl.trim(),
        secret: this.webhookSecret.trim(),
      })
      .subscribe({
        next: (response) => {
          this.isWebhookTesting = false;
          this.errorMessage = '';
          this.addErrorLog('api:webhook-config:test', `Webhook OK (HTTP ${response.status})`);
        },
        error: (error) => {
          this.isWebhookTesting = false;
          this.reportError('api:webhook-config:test', error, 'La prueba de webhook falló');
        },
      });
  }

  clearErrorLogs(): void {
    this.errorLogs = [];
  }

  copyErrorLogs(): void {
    const text = this.errorLogs
      .map((entry) => {
        const session = entry.sessionId ? ` [${entry.sessionId}]` : '';
        return `[${entry.timestamp}] ${entry.source}${session}: ${entry.message}`;
      })
      .join('\n');

    if (!text) return;
    navigator.clipboard?.writeText(text).catch(() => {
      this.addErrorLog('ui:copy', 'No se pudo copiar automáticamente. Copia manualmente desde el panel.');
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

  private rebuildSessionErrorState(list: SessionState[]): void {
    this.lastSessionErrorById.clear();
    for (const session of list) {
      if (session.lastError) {
        this.lastSessionErrorById.set(session.sessionId, session.lastError);
      }
    }
  }

  private reportError(source: string, error: unknown, fallback: string, sessionId?: string): void {
    const message = this.errorToMessage(error, fallback);
    this.errorMessage = message;
    this.addErrorLog(source, message, sessionId);
  }

  private addErrorLog(source: string, message: string, sessionId?: string): void {
    if (!message?.trim()) return;

    this.errorLogs.unshift({
      timestamp: new Date().toISOString(),
      source,
      message: message.trim(),
      sessionId,
    });
    this.errorLogs = this.errorLogs.slice(0, this.maxErrorLogs);
  }

  private errorToMessage(error: unknown, fallback: string): string {
    const err = error as any;
    const apiError = err?.error?.error;
    const msg = err?.message;
    const status = err?.status ? `HTTP ${err.status}` : '';
    const text = [apiError || msg || fallback, status].filter(Boolean).join(' | ');
    return text || fallback;
  }
}
