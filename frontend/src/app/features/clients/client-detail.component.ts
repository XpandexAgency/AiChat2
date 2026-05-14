import { Component, Input, OnDestroy, OnInit, computed, inject, signal, effect } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Client, ClientsService } from '../../core/api/clients.service';
import { SessionsService, WaSession } from '../../core/api/sessions.service';
import { WebhooksService } from '../../core/api/webhooks.service';
import { errorToMessage } from '../../core/api/error';

@Component({
  selector: 'app-client-detail',
  standalone: true,
  imports: [RouterLink, FormsModule, DatePipe],
  templateUrl: './client-detail.component.html',
  styleUrl: './clients.scss',
})
export class ClientDetailComponent implements OnInit, OnDestroy {
  @Input() id?: string;

  private readonly clientsApi = inject(ClientsService);
  private readonly sessionsApi = inject(SessionsService);
  private readonly webhooks = inject(WebhooksService);
  private readonly router = inject(Router);

  readonly client = signal<Client | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly testing = signal(false);

  // Sesiones del cliente: combinamos lo que la BD persiste (initial fetch) con
  // updates en vivo del socket (filter sessions del manager por clientId).
  private readonly persistedSessions = signal<WaSession[]>([]);
  readonly clientSessions = computed<WaSession[]>(() => {
    const cid = Number(this.id);
    const live = this.sessionsApi.sessions().filter((s) => s.clientId === cid);
    const liveIds = new Set(live.map((s) => s.sessionId));
    const persisted = this.persistedSessions().filter((s) => !liveIds.has(s.sessionId));
    return [...live, ...persisted].sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  });

  newSessionId = '';
  newSessionMode: 'normal' | 'business' = 'normal';

  ngOnInit() {
    if (!this.id) return;
    this.load();
  }

  ngOnDestroy() {}

  load() {
    if (!this.id) return;
    const id = Number(this.id);
    this.loading.set(true);
    this.clientsApi.get(id).subscribe({
      next: (c) => { this.client.set(c); this.loading.set(false); },
      error: (err) => { this.error.set(errorToMessage(err, 'No se pudo cargar el cliente')); this.loading.set(false); },
    });
    this.clientsApi.sessions(id).subscribe({
      next: (list) => this.persistedSessions.set(list),
      error: () => this.persistedSessions.set([]),
    });
  }

  deleteClient() {
    const c = this.client();
    if (!c) return;
    if (!confirm(`¿Borrar el cliente "${c.name}"? Esto cierra sus sesiones de WhatsApp y limpia sus credenciales.`)) return;
    this.clientsApi.remove(c.id).subscribe({
      next: () => this.router.navigate(['/clients']),
      error: (err) => this.error.set(errorToMessage(err, 'No se pudo borrar')),
    });
  }

  toggleActive() {
    const c = this.client();
    if (!c) return;
    this.clientsApi.update(c.id, { isActive: !c.isActive }).subscribe({
      next: (updated) => { this.client.set(updated); this.notice.set(updated.isActive ? 'Cliente activado' : 'Cliente desactivado'); },
      error: (err) => this.error.set(errorToMessage(err, 'No se pudo actualizar el estado')),
    });
  }

  testWebhook() {
    const c = this.client();
    if (!c) return;
    this.testing.set(true);
    this.error.set(null);
    this.webhooks.test(c.id).subscribe({
      next: (r) => { this.testing.set(false); this.notice.set(`Webhook OK (HTTP ${r.status})`); },
      error: (err) => { this.testing.set(false); this.error.set(errorToMessage(err, 'Fallo el test de webhook')); },
    });
  }

  startSession() {
    const c = this.client();
    if (!c || !this.newSessionId.trim()) return;
    this.error.set(null);
    this.sessionsApi.start({
      clientId: c.id,
      sessionId: this.newSessionId.trim(),
      mode: this.newSessionMode,
    }).subscribe({
      next: () => {
        this.notice.set('Sesión iniciada — escanea el QR cuando aparezca');
        this.newSessionId = '';
        this.load();
      },
      error: (err) => this.error.set(errorToMessage(err, 'No se pudo iniciar la sesión')),
    });
  }

  stopSession(sid: string) {
    this.sessionsApi.stop(sid).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(errorToMessage(err, 'No se pudo parar la sesión')),
    });
  }

  removeSession(sid: string) {
    if (!confirm(`¿Eliminar la sesión "${sid}"? Se borran las credenciales locales.`)) return;
    this.sessionsApi.remove(sid).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(errorToMessage(err, 'No se pudo eliminar la sesión')),
    });
  }

  statusVariant(status: string): string {
    switch (status) {
      case 'ready':
      case 'authenticated': return 'ok';
      case 'waiting_qr_scan': return 'warn';
      case 'starting': return 'info';
      case 'error':
      case 'auth_failure': return 'err';
      default: return 'mute';
    }
  }

  statusLabel(status: string): string {
    const m: Record<string, string> = {
      starting: 'Iniciando', waiting_qr_scan: 'Esperando QR', authenticated: 'Autenticado',
      ready: 'Conectado', auth_failure: 'Fallo auth', disconnected: 'Desconectado',
      stopped: 'Detenido', error: 'Error',
    };
    return m[status] || status;
  }
}
