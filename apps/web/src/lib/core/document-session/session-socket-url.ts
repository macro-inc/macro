import { SYNC_SERVICE_HOSTS } from '@core/constant/servers';

/** Shared application route for WASM and native document-session transports. */
export function sessionSocketUrl(
  doc: string,
  token: string,
  traceparent: string
) {
  const url = new URL(
    `${SYNC_SERVICE_HOSTS.ws}/document/${encodeURIComponent(doc)}/connect`
  );
  url.searchParams.set('token', token);
  if (traceparent) url.searchParams.set('traceparent', traceparent);
  return url.toString();
}
