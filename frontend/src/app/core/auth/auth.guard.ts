import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, of, switchMap } from 'rxjs';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const redirectToLogin = () => {
    return router.parseUrl(`/login?returnUrl=${encodeURIComponent(state.url)}`);
  };

  if (auth.checked()) {
    return auth.isAuthenticated() ? true : redirectToLogin();
  }

  return auth.hydrate().pipe(
    switchMap((admin) => of(admin ? true : redirectToLogin())),
    map((r) => r),
  );
};

export const guestOnlyGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.checked()) {
    return auth.isAuthenticated() ? router.parseUrl('/') : true;
  }
  return auth.hydrate().pipe(
    switchMap((admin) => of(admin ? router.parseUrl('/') : true)),
  );
};
