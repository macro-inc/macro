import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { docsHref, isDocsAsset } from './documentation';

describe('documentation URLs', () => {
  it('moves legacy guide links while retaining queries and headings', () => {
    expect(
      docsHref('https://docs.macro.com/product/tasks?from=guide#status')
    ).toBe('/tasks?from=guide#guide-status');
    expect(docsHref('/')).toBe('/docs/switch-to-macro');
    expect(docsHref('/index')).toBe('/docs/switch-to-macro');
    expect(docsHref('../concepts/mentions.mdx#sharing', 'product/email')).toBe(
      '/docs/concepts/mentions#sharing'
    );
  });
  it('keeps in-page, external, and email links intact', () => {
    for (const url of [
      '#sharing',
      'mailto:support@macro.com',
      'https://macro.com/app/signup',
      'https://github.com/macro-inc/macro',
    ])
      expect(docsHref(url)).toBe(url);
  });
  it('prefixes embedded reference anchors', () => {
    expect(docsHref('#sharing', 'product/email')).toBe('#guide-sharing');
    expect(docsHref('/product/folders')).toBe('/drive#guide');
    expect(docsHref('/permissions#tasks')).toBe('/docs/product/sharing#tasks');
  });
  it('uses the same asset paths for dev and production', () => {
    expect(docsHref('/images/email.png')).toBe('/docs-assets/images/email.png');
    expect(docsHref('/videos/demo.mp4')).toBe('/docs-assets/videos/demo.mp4');
    expect(docsHref('https://macro.com/video/tutorials/docs.mp4')).toBe(
      '/video/tutorials/docs.mp4'
    );
    expect(docsHref('https://macro.com/video/tutorials/docs-poster.jpg')).toBe(
      '/video/tutorials/docs-poster.jpg'
    );
    expect(docsHref('/video/tutorials/docs.mp4')).toBe(
      '/video/tutorials/docs.mp4'
    );
  });
});

it('does not expose source files through asset path traversal', () => {
  const root = path.resolve(import.meta.dirname, '../../docs');
  expect(isDocsAsset(path.join(root, 'images/email.png'))).toBe(true);
  expect(isDocsAsset(path.join(root, 'images/../docs.json'))).toBe(false);
  expect(
    isDocsAsset(path.join(root, 'images/../../marketing/package.json'))
  ).toBe(false);
});
