import { beforeEach, expect, it } from 'vitest';
import { buildSeoTagsHtml, DEFAULT_OG_IMAGE, setPageSeo } from './utilSeo';

beforeEach(() => {
  document.head.innerHTML = '';
});

it('pairs the homepage unification video with its clean image and X image card', () => {
  document.head.innerHTML = buildSeoTagsHtml({
    title: 'Macro',
    description: 'Team workspace',
    path: '/',
  }).join('');
  expect(
    document.querySelector('meta[property="og:video"]')?.getAttribute('content')
  ).toMatch(/\/og\/home-unified-2026-10-23\.mp4$/);
  expect(
    document
      .querySelector('meta[property="og:video:type"]')
      ?.getAttribute('content')
  ).toBe('video/mp4');
  expect(
    document.querySelector('meta[property="og:image"]')?.getAttribute('content')
  ).toBe(DEFAULT_OG_IMAGE);
  expect(
    document
      .querySelector('meta[name="twitter:image"]')
      ?.getAttribute('content')
  ).toBe(DEFAULT_OG_IMAGE);
  expect(
    document.querySelector('meta[name="twitter:card"]')?.getAttribute('content')
  ).toBe('summary_large_image');
  expect(
    document.querySelector('meta[property="og:type"]')?.getAttribute('content')
  ).toBe('website');
});

it('keeps product and article cards image-only and clears homepage video on navigation', () => {
  setPageSeo({ title: 'Macro', description: 'Workspace', path: '/' });
  expect(document.querySelector('meta[property="og:video"]')).not.toBeNull();
  for (const path of ['/tasks', '/posts/example']) {
    const seo = {
      title: 'Example',
      description: 'Example',
      path,
      image: 'https://macro.com/og/example.png',
    };
    setPageSeo(seo);
    expect(
      document.querySelectorAll('meta[property^="og:video"]')
    ).toHaveLength(0);
    expect(
      document
        .querySelector('meta[name="twitter:image"]')
        ?.getAttribute('content')
    ).toBe(seo.image);
    document.head.innerHTML = buildSeoTagsHtml(seo).join('');
    expect(
      document.querySelectorAll('meta[property^="og:video"]')
    ).toHaveLength(0);
    expect(
      document
        .querySelector('meta[property="og:image"]')
        ?.getAttribute('content')
    ).toBe(seo.image);
  }
});
