import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Client, ClientInput, ClientsService } from '../../core/api/clients.service';
import { errorToMessage } from '../../core/api/error';

@Component({
  selector: 'app-client-form',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './client-form.component.html',
  styleUrl: './clients.scss',
})
export class ClientFormComponent implements OnInit {
  @Input() id?: string; // del router input binding

  private readonly api = inject(ClientsService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  isEdit = false;
  model: {
    name: string;
    email: string;
    phone: string;
    description: string;
    isActive: boolean;
    tagsText: string;
    webhookIncomingUrl: string;
    webhookSecret: string;
  } = {
    name: '',
    email: '',
    phone: '',
    description: '',
    isActive: true,
    tagsText: '',
    webhookIncomingUrl: '',
    webhookSecret: '',
  };

  hasExistingSecret = false;

  ngOnInit() {
    if (this.id) {
      this.isEdit = true;
      this.load(Number(this.id));
    }
  }

  private load(id: number) {
    this.loading.set(true);
    this.api.get(id).subscribe({
      next: (c) => this.hydrate(c),
      error: (err) => { this.error.set(errorToMessage(err, 'No se pudo cargar el cliente')); this.loading.set(false); },
    });
  }

  private hydrate(c: Client) {
    this.model = {
      name: c.name,
      email: c.email ?? '',
      phone: c.phone ?? '',
      description: c.description ?? '',
      isActive: c.isActive,
      tagsText: (c.tags || []).join(', '),
      webhookIncomingUrl: c.webhookIncomingUrl ?? '',
      webhookSecret: '',
    };
    this.hasExistingSecret = c.webhookSecretConfigured;
    this.loading.set(false);
  }

  submit() {
    if (!this.model.name.trim()) {
      this.error.set('El nombre es obligatorio');
      return;
    }
    this.saving.set(true);
    this.error.set(null);

    const tags = this.model.tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const payload: ClientInput = {
      name: this.model.name.trim(),
      email: this.model.email.trim() || null,
      phone: this.model.phone.trim() || null,
      description: this.model.description.trim() || null,
      isActive: this.model.isActive,
      tags,
      webhookIncomingUrl: this.model.webhookIncomingUrl.trim() || null,
    };

    // Solo enviar webhookSecret si el usuario lo escribió (preserva el actual si está vacío en edit)
    if (this.model.webhookSecret) {
      payload.webhookSecret = this.model.webhookSecret;
    } else if (!this.isEdit) {
      payload.webhookSecret = null;
    }

    const req$ = this.isEdit && this.id
      ? this.api.update(Number(this.id), payload)
      : this.api.create(payload);

    req$.subscribe({
      next: (c) => {
        this.saving.set(false);
        this.router.navigate(['/clients', c.id]);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(errorToMessage(err, 'No se pudo guardar'));
      },
    });
  }
}
