import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { isTauri } from './platform';
import shortuuid from 'short-uuid';

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

function getWebOrigin(): string {
  if (isTauri()) {
    return import.meta.env.MODE === 'development'
      ? 'https://dev.macro.com'
      : 'https://macro.com';
  }
  return window.location.origin;
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

export function propsToHref(props: { fileType?: string | null; id: string }) {
  const id = props.id;
  const blockName = fileTypeToBlockName(props.fileType);
  return `/${blockName}/${id}`;
}

export function buildSimpleEntityUrl(
  entity: { type: string; id: string },
  params: Record<string, any>
): string {
  const urlString = `${getWebOrigin()}/app/${entity.type}/${entity.id}`;
  const url = new URL(urlString);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
