import { expect, it } from 'vitest';
import {
  curateSearchPages,
  postSearchPage,
  publicSearchPages,
  sourceSearchText,
} from './site-search';

it('removes noisy references and merges guide content into its feature', () => {
  const feature = {
    href: '/spreadsheets',
    title: 'Spreadsheets',
    context: 'Features',
    text: 'Agent editing',
  };
  const pages = curateSearchPages([
    feature,
    {
      ...feature,
      href: '/spreadsheets#guide',
      context: 'Blocks',
      text: 'Excel import',
    },
    { ...feature, href: '/docs/changelog/2026-05' },
    { ...feature, href: '/docs/AI/mcp/tools/read-spreadsheet' },
    { ...feature, href: '/jobs', context: 'Company' },
    { ...feature, href: '/privacy', context: 'Legal' },
    { ...feature, href: '/posts/rate-limits', context: 'Blog · Engineering' },
  ]);
  expect(pages).toEqual([{ ...feature, text: 'Agent editing Excel import' }]);
  expect(feature.text).toBe('Agent editing');
});

it('extracts article metadata and body copy without importing the component', () => {
  const source = `import X from './never-load'; export const postMeta = {slug: 'sample', title: 'Sample article', category: 'Comparison'}; export default () => <p class="hidden-code">A customer email becomes a task.</p>;`;
  expect(postSearchPage(source)).toMatchObject({
    href: '/posts/sample',
    title: 'Sample article',
    context: 'Blog · Comparison',
  });
  expect(sourceSearchText(source)).toContain(
    'A customer email becomes a task.'
  );
  expect(sourceSearchText(source)).not.toContain('hidden-code');
  expect(sourceSearchText(source)).not.toContain('never-load');
  expect(
    sourceSearchText(
      '<Hero title="People and agents" description="Share work in channels." class="hidden-code" />'
    )
  ).toBe('People and agents Share work in channels.');
});
it('includes features, comparisons, and standalone pages with unique destinations', () => {
  const pages = publicSearchPages(() => {});
  const hrefs = pages.map((p) => p.href);
  expect(hrefs).toEqual(
    expect.arrayContaining([
      '/email',
      '/calendar',
      '/posts/linear-alternative',
      '/posts/notion-alternative',
      '/pricing',
      '/replace-apps',
      '/privacy',
      '/partners/terms',
    ])
  );
  expect(new Set(hrefs).size).toBe(hrefs.length);
  expect(
    pages.find((p) => p.href === '/posts/linear-alternative')?.text
  ).toContain('keyboard');
});
