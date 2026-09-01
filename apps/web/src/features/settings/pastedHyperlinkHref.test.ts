import { describe, expect, it } from 'vitest';
import { pastedHyperlinkHref } from './pastedHyperlinkHref.ts';

const textSelection = [{ insert: 'word' }];

describe('pastedHyperlinkHref', function () {
  it('applies a selected https URL as the hyperlink href', function () {
    expect(
      pastedHyperlinkHref({
        clipboardPlainText: 'https://lunchflow.app',
        selectionCollapsed: false,
        selectionOps: textSelection,
      })
    ).toBe('https://lunchflow.app');
  });

  it('applies nothing when the selection is collapsed', function () {
    expect(
      pastedHyperlinkHref({
        clipboardPlainText: 'https://lunchflow.app',
        selectionCollapsed: true,
        selectionOps: textSelection,
      })
    ).toBeNull();
  });

  it('trims address-bar whitespace before applying the href', function () {
    expect(
      pastedHyperlinkHref({
        clipboardPlainText: '  https://lunchflow.app \n',
        selectionCollapsed: false,
        selectionOps: textSelection,
      })
    ).toBe('https://lunchflow.app');
  });

  it('applies a selected http URL as the hyperlink href', function () {
    expect(
      pastedHyperlinkHref({
        clipboardPlainText: 'http://lunchflow.app',
        selectionCollapsed: false,
        selectionOps: textSelection,
      })
    ).toBe('http://lunchflow.app');
  });

  it('applies an uppercase scheme', function () {
    expect(
      pastedHyperlinkHref({
        clipboardPlainText: 'HTTPS://lunchflow.app',
        selectionCollapsed: false,
        selectionOps: textSelection,
      })
    ).toBe('HTTPS://lunchflow.app');
  });

  it('applies a URL with a path, query, and fragment', function () {
    expect(
      pastedHyperlinkHref({
        clipboardPlainText: 'https://example.com/a?b=1#c',
        selectionCollapsed: false,
        selectionOps: textSelection,
      })
    ).toBe('https://example.com/a?b=1#c');
  });

  it('applies nothing for a bare host', function () {
    expect(
      pastedHyperlinkHref({
        clipboardPlainText: 'example.com',
        selectionCollapsed: false,
        selectionOps: textSelection,
      })
    ).toBeNull();
  });

  it('applies nothing for a host without a scheme', function () {
    expect(
      pastedHyperlinkHref({
        clipboardPlainText: 'Faith.tools',
        selectionCollapsed: false,
        selectionOps: textSelection,
      })
    ).toBeNull();
  });

  it('applies nothing when two URLs are separated by a newline', function () {
    expect(
      pastedHyperlinkHref({
        clipboardPlainText: 'https://example.com\nhttps://other.com',
        selectionCollapsed: false,
        selectionOps: textSelection,
      })
    ).toBeNull();
  });

  it('applies nothing when the clipboard is a URL plus extra words', function () {
    expect(
      pastedHyperlinkHref({
        clipboardPlainText: 'https://example.com extra words',
        selectionCollapsed: false,
        selectionOps: textSelection,
      })
    ).toBeNull();
  });

  it('applies nothing for a relative path', function () {
    expect(
      pastedHyperlinkHref({
        clipboardPlainText: '/pricing',
        selectionCollapsed: false,
        selectionOps: textSelection,
      })
    ).toBeNull();
  });

  it('applies nothing for mailto or javascript schemes', function () {
    expect(
      pastedHyperlinkHref({
        clipboardPlainText: 'mailto:amr@lunchflow.app',
        selectionCollapsed: false,
        selectionOps: textSelection,
      })
    ).toBeNull();
    expect(
      pastedHyperlinkHref({
        clipboardPlainText: 'javascript:alert(1)',
        selectionCollapsed: false,
        selectionOps: textSelection,
      })
    ).toBeNull();
  });

  it('applies nothing for empty clipboard text', function () {
    expect(
      pastedHyperlinkHref({
        clipboardPlainText: '',
        selectionCollapsed: false,
        selectionOps: textSelection,
      })
    ).toBeNull();
  });

  it('applies nothing when the selection is an image embed', function () {
    expect(
      pastedHyperlinkHref({
        clipboardPlainText: 'https://example.com',
        selectionCollapsed: false,
        selectionOps: [{ insert: { image: 'https://cdn.example/sig.png' } }],
      })
    ).toBeNull();
  });

  it('applies nothing when the selection mixes text and an image', function () {
    expect(
      pastedHyperlinkHref({
        clipboardPlainText: 'https://example.com',
        selectionCollapsed: false,
        selectionOps: [
          { insert: 'caption' },
          { insert: { image: 'https://cdn.example/sig.png' } },
        ],
      })
    ).toBeNull();
  });
});
