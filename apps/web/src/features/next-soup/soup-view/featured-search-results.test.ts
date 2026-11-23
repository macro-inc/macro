import type { EntityData } from '@entity';
import type { WithSearch } from '@entity/types/search';
import { expect, it } from 'vitest';
import {
  featuredDocumentIds,
  featureSearchResults,
  withFeaturedDocumentData,
} from './featured-search-results';

const localSearch = {
  nameHighlight: '<macro_em>budget</macro_em> review',
  senderHighlightTerms: null,
  contentHitData: null,
  source: 'local',
} as const;

const localTask = {
  id: 'task-1',
  type: 'document',
  name: 'budget review',
  subType: { type: 'task', is_completed: false },
  search: localSearch,
} as unknown as WithSearch<EntityData>;

const localChannel = {
  id: 'channel-1',
  type: 'channel',
  name: 'budget',
  search: localSearch,
} as unknown as WithSearch<EntityData>;

const soupTask = {
  id: 'task-1',
  type: 'document',
  name: 'budget review',
  subType: { type: 'task', is_completed: false },
  properties: [{ id: 'p1', definition: { id: 'status' } }],
} as unknown as EntityData;

it('reads Soup rows for featured documents and tasks only', () => {
  expect(featuredDocumentIds([localChannel, localTask])).toEqual(['task-1']);
});

it('gives a featured task its Soup properties and keeps its name highlight', () => {
  const [channel, task] = withFeaturedDocumentData(
    [localChannel, localTask],
    [soupTask]
  );
  expect(channel).toBe(localChannel);
  expect(task).toMatchObject({
    id: 'task-1',
    properties: [{ id: 'p1' }],
    search: localSearch,
  });
});

it('leaves a featured row as it is until its Soup row loads', () => {
  expect(withFeaturedDocumentData([localTask], [])).toEqual([localTask]);
});

it('features only the rows the list still shows, in featured order', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  expect(featureSearchResults(rows, ['c', 'filtered-out', 'a'])).toEqual({
    entities: [{ id: 'c' }, { id: 'a' }, { id: 'b' }],
    featuredIds: ['c', 'a'],
  });
});

it('features nothing when every featured row is filtered out', () => {
  const rows = [{ id: 'a' }];
  expect(featureSearchResults(rows, ['filtered-out'])).toEqual({
    entities: rows,
    featuredIds: [],
  });
});
