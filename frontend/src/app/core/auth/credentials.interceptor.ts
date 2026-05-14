import { HttpInterceptorFn } from '@angular/common/http';

// Asegura que las cookies httpOnly viajen con cada petición al backend.
// En dev el proxy hace que /api sea same-origin; en prod frontend+backend
// comparten dominio. Aún así pedimos credentials explícitamente.
export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req.clone({ withCredentials: true }));
};
