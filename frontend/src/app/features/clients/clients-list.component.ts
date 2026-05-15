import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Client, ClientsService } from '../../core/api/clients.service';
import { errorToMessage } from '../../core/api/error';

@Component({
  selector: 'app-clients-list',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './clients-list.component.html',
  styleUrl: './clients.scss',
})
export class ClientsListComponent implements OnInit {
  private readonly api = inject(ClientsService);

  readonly clients = signal<Client[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly activeOnly = signal(false);

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.api.list(this.activeOnly()).subscribe({
      next: (list) => { this.clients.set(list); this.loading.set(false); },
      error: (err) => { this.error.set(errorToMessage(err, 'No se pudieron cargar los clientes')); this.loading.set(false); },
    });
  }

  toggleActiveOnly() {
    this.activeOnly.set(!this.activeOnly());
    this.load();
  }
}
