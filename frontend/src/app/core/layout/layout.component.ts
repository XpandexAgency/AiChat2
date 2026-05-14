import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { SessionsService } from '../api/sessions.service';
import { OnInit, OnDestroy } from '@angular/core';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './layout.component.html',
  styleUrl: './layout.component.scss',
})
export class LayoutComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly sessionsService = inject(SessionsService);

  readonly admin = this.auth.admin;
  readonly socketConnected = this.sessionsService.socketConnected;

  private socketUnsub: (() => void) | null = null;

  ngOnInit() {
    // Mantener un socket vivo mientras el shell esté montado
    this.socketUnsub = this.sessionsService.connect();
  }

  ngOnDestroy() {
    this.socketUnsub?.();
  }

  logout() {
    this.auth.logout().subscribe(() => {
      this.router.navigate(['/login']);
    });
  }
}
