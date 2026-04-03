import shortuuid from 'short-uuid';
import { getWebOrigin } from './webOrigin';

const short = shortuuid(shortuuid.constants.flickrBase58, {
  consistentLength: false,
});

function unwrapShortId(id: string): string {
  // Check if a string is valid (length and alphabet) *AND* translates to a valid UUID
  if (short.validate(id, true)) {
    return short.toUUID(id);
  }
  return id;
}

export function openExternalUrl(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')?.focus();
}

export function transformShortIdInUrlPathname(pathname: string) {
  const parts = pathname.split('/');
  const newParts = [];
  for (const part of parts) {
    newParts.push(unwrapShortId(part));
  }
  const newPathname = newParts.join('/');
  return newPathname;
}

export function buildSimpleEntityUrl(
  entity: { type: string; id: string },
  params?: Record<string, string>
): string {
  const urlString = `${getWebOrigin()}/app/${entity.type}/${entity.id}`;
  const url = new URL(urlString);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}
