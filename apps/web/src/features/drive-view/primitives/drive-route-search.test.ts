import { expect, it } from 'vitest';
import { driveSearch, driveSearchCodec } from './drive-search';

it('keeps document comments separate from Drive view facets', () => {
  const { value, valid } = driveSearchCodec.parse({
    scope: ['all'],
    sort: ['created_at'],
    tags: ['first', 'second'],
    commentId: ['old', 'comment-1'],
  });

  expect(valid).toBe(true);
  expect(value).toEqual({
    scope: 'all',
    sort: 'created_at',
    facets: { tags: ['first', 'second'] },
    commentId: 'comment-1',
  });
  expect(driveSearchCodec.serialize(value)).toEqual({
    scope: ['all'],
    sort: ['created_at'],
    tags: ['first', 'second'],
    commentId: ['comment-1'],
  });
});

it('ignores comment facets from legacy JSON without discarding other facets', () => {
  const { value } = driveSearchCodec.parse({
    facets: [JSON.stringify({ commentId: ['old'], tags: ['important'] })],
    commentId: ['comment-1'],
  });

  expect(value.facets).toEqual({ tags: ['important'] });
  expect(value.commentId).toBe('comment-1');
  expect(
    driveSearchCodec.serialize({
      ...driveSearch.defaults,
      ...value,
      facets: { ...value.facets, commentId: ['not-a-facet'] },
    })
  ).toEqual({ tags: ['important'], commentId: ['comment-1'] });
});
