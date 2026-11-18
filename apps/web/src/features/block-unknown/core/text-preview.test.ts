import { describe, expect, it } from 'vitest';
import {
  decodeTextPreview,
  mayContainText,
  TEXT_PREVIEW_MAX_LINES,
  textPreviewState,
} from './text-preview';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('mayContainText', () => {
  it('reads a file whose name had no recognized extension', () => {
    expect(mayContainText(null)).toBe(true);
    expect(mayContainText(undefined)).toBe(true);
  });

  it('reads text types that have no block of their own', () => {
    expect(mayContainText('env')).toBe(true);
    expect(mayContainText('ics')).toBe(true);
    expect(mayContainText('vcf')).toBe(true);
  });

  it('never downloads a file of a known binary type', () => {
    expect(mayContainText('zip')).toBe(false);
    expect(mayContainText('exe')).toBe(false);
    expect(mayContainText('doc')).toBe(false);
    expect(mayContainText('ppt')).toBe(false);
    expect(mayContainText('xls')).toBe(false);
  });

  it('leaves a type this build does not know as a download', () => {
    expect(mayContainText('from-a-newer-server')).toBe(false);
  });
});

describe('decodeTextPreview', () => {
  it('keeps text as written, without the final newline', () => {
    expect(decodeTextPreview(bytes('QA test attachment\n'))).toBe(
      'QA test attachment'
    );
    expect(decodeTextPreview(bytes('# title\n\n  indented\n'))).toBe(
      '# title\n\n  indented'
    );
  });

  it('keeps blank lines the file ends with beyond the final newline', () => {
    expect(decodeTextPreview(bytes('a\n\n\n'))).toBe('a\n\n');
  });

  it('normalizes Windows and classic Mac line endings', () => {
    expect(decodeTextPreview(bytes('a\r\nb\rc\n'))).toBe('a\nb\nc');
  });

  it('reads non-ASCII text and drops a byte order mark', () => {
    expect(decodeTextPreview(bytes('héllo 你好'))).toBe('héllo 你好');
    expect(
      decodeTextPreview(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))
    ).toBe('hi');
  });

  it('leaves a file with too many lines to render as a download', () => {
    const atLimit = 'a\n'.repeat(TEXT_PREVIEW_MAX_LINES);

    expect(decodeTextPreview(bytes(atLimit))).not.toBeNull();
    expect(decodeTextPreview(bytes(`${atLimit}a\n`))).toBeNull();
  });

  it('rejects binary content', () => {
    expect(decodeTextPreview(new Uint8Array([0x68, 0x00, 0x69]))).toBeNull();
    expect(decodeTextPreview(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe('textPreviewState', () => {
  it('keeps every line in one paragraph, so copied text has no extra blank lines', () => {
    const { root } = JSON.parse(textPreviewState('one\n\n  three'));

    expect(root.children).toHaveLength(1);
    expect(
      root.children[0].children.map(
        (node: { type: string; text?: string }) => node.text ?? node.type
      )
    ).toEqual(['one', 'linebreak', 'linebreak', '  three']);
  });
});
