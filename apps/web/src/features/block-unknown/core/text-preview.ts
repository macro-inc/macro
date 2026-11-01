import { FileTypeMap } from '@service-storage/fileTypeMap';
import { Result } from 'neverthrow';

/** The static renderer mounts every line, so bigger files stay a download. */
export const TEXT_PREVIEW_MAX_BYTES = 1_000_000;

const FILE_TYPES: Record<string, { mime: string } | undefined> = FileTypeMap;

/**
 * Text types with a block of their own never reach the unknown block. A
 * missing file type means the name had no recognized extension, so only the
 * bytes can tell.
 */
export function mayContainText(fileType: string | null | undefined): boolean {
  if (!fileType) return true;
  return FILE_TYPES[fileType]?.mime.startsWith('text/') ?? false;
}

const decodeUtf8 = Result.fromThrowable((bytes: Uint8Array) =>
  new TextDecoder('utf-8', { fatal: true }).decode(bytes)
);

/** The file's text with one newline style, or null when it is not UTF-8 text. */
export function decodeTextPreview(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  const text = decodeUtf8(bytes);
  if (text.isErr()) return null;
  return text.value.replace(/\r\n?/g, '\n').replace(/\n$/, '');
}
