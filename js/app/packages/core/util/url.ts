import { fileTypeToBlockName } from '@core/constant/allBlocks';
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
  const urlString = `${window.location.origin}/app/${entity.type}/${entity.id}`;
  const url = new URL(urlString);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
