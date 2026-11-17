import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_CSP,
  composeArtifactDocument,
  isArtifactLoadMarker,
} from './artifact-document';

const NO_LIBRARY = { styles: {}, components: {} };

const parse = (html: string) =>
  new DOMParser().parseFromString(html, 'text/html');

describe('composeArtifactDocument', () => {
  it('parses the content security policy before anything in the artifact', () => {
    const composed = composeArtifactDocument(
      '<html><head><script>run()</script></head><body>Hi</body></html>',
      {},
      NO_LIBRARY,
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
      NO_LIBRARY,
      'token'
    );

    expect(parse(composed).head.firstElementChild?.tagName).toBe('META');
  });

  it('removes meta refresh, which would navigate out of the policy', () => {
    const composed = composeArtifactDocument(
      '<meta http-equiv="REFRESH" content="0;url=https://example.com"><p>Hi</p>',
      {},
      NO_LIBRARY,
      'token'
    );

    expect(composed).not.toContain('example.com');
    expect(composed).toContain('<p>Hi</p>');
  });

  it('exposes theme tokens as CSS variables', () => {
    const composed = composeArtifactDocument(
      '<p>Hi</p>',
      { '--color-ink': '#111' },
      NO_LIBRARY,
      'token'
    );

    expect(composed).toContain(':root{--color-ink:#111}');
  });

  it('expands components around their children, including nested ones', () => {
    const composed = composeArtifactDocument(
      '<macro-component name="card"><macro-component name="title">Hi</macro-component></macro-component>',
      {},
      {
        styles: {},
        components: {
          card: '<section class="card"><slot></slot></section>',
          title: '<h1><slot></slot></h1>',
        },
      },
      'token'
    );

    expect(parse(composed).body.innerHTML).toBe(
      '<section class="card"><h1>Hi</h1></section>'
    );
  });

  it('terminates on components that use each other', () => {
    const composed = composeArtifactDocument(
      '<macro-component name="a"></macro-component>',
      {},
      {
        styles: {},
        components: {
          a: '<macro-component name="b"></macro-component>',
          b: '<macro-component name="a"></macro-component>',
        },
      },
      'token'
    );

    expect(composed).not.toContain('macro-component');
  });

  it('stops expanding a component that fans out past the budget', () => {
    const fanOut = '<macro-component name="a"></macro-component>'.repeat(20);
    const composed = composeArtifactDocument(
      '<macro-component name="a"></macro-component>',
      {},
      { styles: {}, components: { a: fanOut } },
      'token'
    );

    expect(composed).not.toContain('macro-component');
  });

  it('adds shared styles and drops unknown names', () => {
    const composed = composeArtifactDocument(
      '<macro-style name="brand"></macro-style><macro-style name="constructor"></macro-style><macro-component name="constructor">Kept</macro-component>',
      {},
      { styles: { brand: 'h1{color:red}' }, components: {} },
      'token'
    );

    expect(composed).toContain('<style>h1{color:red}</style>');
    expect(composed).not.toContain('macro-style');
    expect(parse(composed).body.textContent).toContain('Kept');
  });

  it('marks its own load before any artifact script can run', () => {
    const composed = composeArtifactDocument(
      '<script>run()</script>',
      {},
      NO_LIBRARY,
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
