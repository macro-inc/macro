import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_CSP,
  composeArtifactDocument,
  isArtifactLoadMarker,
} from './artifact-document';

const parse = (html: string) =>
  new DOMParser().parseFromString(html, 'text/html');

describe('composeArtifactDocument', () => {
  it('parses the content security policy before anything in the artifact', () => {
    const composed = composeArtifactDocument(
      '<html><head><script>run()</script></head><body>Hi</body></html>',
      {},
      'token'
    );

    const first = parse(composed).head.firstElementChild;
    expect(first?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(first?.getAttribute('content')).toBe(ARTIFACT_CSP);
    expect(composed.indexOf('Content-Security-Policy')).toBeLessThan(
      composed.indexOf('<script>')
    );
  });

  it('keeps the policy first for a fragment with no head', () => {
    const composed = composeArtifactDocument(
      '<script>run()</script>',
      {},
      'token'
    );

    expect(parse(composed).head.firstElementChild?.tagName).toBe('META');
  });

  it('removes meta refresh, which would navigate out of the policy', () => {
    const composed = composeArtifactDocument(
      '<meta http-equiv="REFRESH" content="0;url=https://example.com"><p>Hi</p>',
      {},
      'token'
    );

    expect(composed).not.toContain('example.com');
    expect(composed).toContain('<p>Hi</p>');
  });

  it('exposes theme tokens as CSS variables', () => {
    const composed = composeArtifactDocument(
      '<p>Hi</p>',
      { '--color-ink': '#111' },
      'token'
    );

    expect(composed).toContain(':root{--color-ink:#111}');
  });

  it('marks its own load before any artifact script can run', () => {
    const composed = composeArtifactDocument(
      '<script>run()</script>',
      {},
      'secret'
    );

    expect(composed.indexOf('secret')).toBeLessThan(composed.indexOf('run()'));
    expect(
      isArtifactLoadMarker({ macroArtifactLoaded: 'secret' }, 'secret')
    ).toBe(true);
    expect(
      isArtifactLoadMarker({ macroArtifactLoaded: 'guess' }, 'secret')
    ).toBe(false);
  });
});
