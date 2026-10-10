/**
 * Public origin of this deployment, for the URLs the payment provider
 * redirects back to. `NEXT_PUBLIC_SITE_URL` wins when set; otherwise
 * the origin the request arrived on (correct on preview deployments).
 */
export function appUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  return new URL(request.url).origin;
}
