import { FileTypeMap } from '@service-storage/fileTypeMap';
import { Result } from 'neverthrow';

// The static renderer mounts every line, so bigger files stay a download. Lines
// need a limit of their own: a megabyte of short lines freezes the tab.
export const TEXT_PREVIEW_MAX_BYTES = 1_000_000;
export const TEXT_PREVIEW_MAX_LINES = 20_000;

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

/**
 * The file's text with one newline style, or null when it has no preview:
 * it is not UTF-8 text, or has too many lines to render.
 */
export function decodeTextPreview(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  const decoded = decodeUtf8(bytes);
  if (decoded.isErr()) return null;
  const text = decoded.value.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  return text.split('\n').length > TEXT_PREVIEW_MAX_LINES ? null : text;
}

/**
 * A Lexical state holding the text as one paragraph of line breaks. A paragraph
 * per line would put a blank line between every line of copied text.
 */
export function textPreviewState(text: string): string {
  const children = text.split('\n').flatMap((line, index) => [
    ...(index > 0 ? [{ type: 'linebreak', version: 1 }] : []),
    ...(line
      ? [
          {
            type: 'text',
            version: 1,
            text: line,
            format: 0,
            detail: 0,
            mode: 'normal',
            style: '',
          },
        ]
      : []),
  ]);
  return JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      direction: null,
      format: '',
      indent: 0,
      children: [
        {
          type: 'paragraph',
          version: 1,
          direction: null,
          format: '',
          indent: 0,
          children,
        },
      ],
    },
  });
}
