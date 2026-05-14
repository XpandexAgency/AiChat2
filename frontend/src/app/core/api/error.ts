export function errorToMessage(error: unknown, fallback = 'Error inesperado'): string {
  const e = error as any;
  const apiError = e?.error?.error;
  const msg = e?.message;
  const status = e?.status ? `HTTP ${e.status}` : '';
  const text = [apiError || msg || fallback, status].filter(Boolean).join(' | ');
  return text || fallback;
}
