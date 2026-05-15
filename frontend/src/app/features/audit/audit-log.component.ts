import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { AuditFilters, AuditLogEntry, AuditService } from '../../core/api/audit.service';
import { errorToMessage } from '../../core/api/error';

@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [FormsModule, DatePipe],
  templateUrl: './audit-log.component.html',
  styleUrl: './audit-log.component.scss',
})
export class AuditLogComponent implements OnInit {
  private readonly api = inject(AuditService);

  readonly entries = signal<AuditLogEntry[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  filters: AuditFilters & { adminIdText: string } = {
    adminIdText: '',
    action: '',
    startDate: '',
    endDate: '',
  };

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    const f: AuditFilters = {
      adminId: this.filters.adminIdText ? Number(this.filters.adminIdText) : null,
      action: this.filters.action || null,
      startDate: this.filters.startDate || null,
      endDate: this.filters.endDate || null,
    };
    this.api.list(f).subscribe({
      next: (list) => { this.entries.set(list); this.loading.set(false); },
      error: (err) => { this.error.set(errorToMessage(err, 'No se pudo cargar el audit log')); this.loading.set(false); },
    });
  }

  clearFilters() {
    this.filters = { adminIdText: '', action: '', startDate: '', endDate: '' };
    this.load();
  }

  detailsPreview(d: any): string {
    if (!d) return '';
    try {
      const obj = typeof d === 'string' ? JSON.parse(d) : d;
      const keys = Object.keys(obj || {});
      if (!keys.length) return '';
      return keys.map((k) => `${k}=${JSON.stringify(obj[k])}`).join(' · ');
    } catch {
      return String(d);
    }
  }
}
