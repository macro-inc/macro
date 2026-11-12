import { expect, it } from 'vitest';
import { createPageSearch } from './page-search';

const search = createPageSearch([
  {
    href: '/calendar',
    title: 'Calendar',
    context: 'Features',
    text: 'Schedule meetings across your accounts.',
  },
  {
    href: '/posts/linear-alternative',
    title: 'Macro vs Linear',
    context: 'Blog · Comparison',
    text: 'Customer emails link to tasks and pull requests. Calendar notifications.',
  },
  {
    href: '/docs/tool',
    title: 'ReadContent',
    context: 'Agents · Tool reference',
    text: 'Read a document using its ID.',
  },
]);
it('ranks title matches above body matches and supports partial titles', () => {
  expect(search('cal').map((p) => p.href)).toEqual([
    '/calendar',
    '/posts/linear-alternative',
  ]);
});
it('finds body text across different page types and requires every query word', () => {
  expect(search('customer pull')[0]?.href).toBe('/posts/linear-alternative');
  expect(search('document ID')[0]?.href).toBe('/docs/tool');
  expect(search('customer document')).toEqual([]);
});
it('tolerates transposed and missing letters in titles', () => {
  expect(search('calednar')[0]?.href).toBe('/calendar');
  expect(search('calenar')[0]?.href).toBe('/calendar');
});
it('does not return everything for empty or punctuation-only input', () => {
  expect(search(' ')).toEqual([]);
  expect(search('??')).toEqual([]);
});

it('limits broad queries to the eight highest-ranked results', () => {
  const search = createPageSearch(
    Array.from({ length: 12 }, (_, i) => ({
      href: `/page-${i}`,
      title: `Page ${i}`,
      context: 'Features',
      text: 'Shared topic',
    }))
  );
  expect(search('shared')).toHaveLength(8);
});
