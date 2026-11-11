import { describe, expect, it } from 'vitest';
import { composePlainDocument } from './macro-styles';

const THEME = ':root{color-scheme:light;--color-ink:#111}';

describe('composePlainDocument', () => {
  it('returns a page that doesn’t link macro:styles exactly as stored', () => {
    const html =
      '<html><body><p>macro:styles is just text here</p></body></html>';
    expect(composePlainDocument(html, THEME)).toBe(html);
  });

  it('installs the theme and stylesheet without adding a policy or helper', () => {
    const composed = composePlainDocument(
      '<!doctype html><html><head><link rel="stylesheet" href="macro:styles"></head><body><p>Hi</p></body></html>',
      THEME
    );
    const document = new DOMParser().parseFromString(composed, 'text/html');
    expect(document.querySelector('style[data-macro-theme]')?.textContent).toBe(
      THEME
    );
    expect(document.querySelector('meta[http-equiv]')).toBeNull();
    expect(composed).not.toContain("'macro'");
    expect(composed.startsWith('<!doctype html>')).toBe(true);
  });
});
