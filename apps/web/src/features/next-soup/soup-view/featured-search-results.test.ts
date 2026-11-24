import type { EntityData } from '@entity';
import type { WithSearch } from '@entity/types/search';
import { expect, it } from 'vitest';
import {
  featuredDocumentIds,
  featureSearchResults,
  rankBestMatches,
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

const chat = (
  id: string,
  name: string,
  channelType: 'direct_message' | 'private' | 'public' | 'team'
) => ({ id, type: 'channel', name, channelType }) as unknown as EntityData;

const doc = (id: string, name: string) =>
  ({ id, type: 'document', name }) as unknown as EntityData;

it('lists the people, then at most three best matches, and folds the other chats', () => {
  const local = [
    chat('g1', 'Ana Silva, Ben Okafor', 'private'),
    chat('g2', 'Chloe Park, Ana Silva', 'private'),
    chat('support', 'Macro Support x hanako', 'private'),
    chat('dm-anabel', 'Anabel Ruiz', 'direct_message'),
    chat('g3', 'Ana Silva, Dev Rao, Ben Okafor', 'private'),
    chat('dm-ana', 'Ana Silva', 'direct_message'),
    doc('notes', 'Ana’s onboarding notes'),
  ];

  const { best, moreChats } = rankBestMatches(local, 'ana');

  expect(best).toEqual(['dm-ana', 'dm-anabel', 'notes']);
  expect(moreChats).toEqual(['g1', 'g3', 'g2', 'support']);
});

it('ranks the exact name, then the start of a name, then a later word, then letters inside a word', () => {
  const local = [
    chat('inside', 'Macro Support x relaunch.co', 'public'),
    doc('plan', 'Q3 launch plan'),
    chat('ops', 'launch-ops', 'public'),
    chat('launch', 'launch', 'public'),
  ];

  const { best, moreChats } = rankBestMatches(local, 'launch');

  expect(best).toEqual(['launch', 'ops', 'plan']);
  expect(moreChats).toEqual(['inside']);
});

it('keeps a channel with the letters inside a word ahead of nothing but looser matches', () => {
  const { best } = rankBestMatches(
    [doc('loose', 'Assorted notes'), chat('inside', 'banana-bread', 'public')],
    'ana'
  );

  expect(best).toEqual(['inside', 'loose']);
});

it('puts smaller group chats first among equal matches', () => {
  const { best } = rankBestMatches(
    [
      chat('big', 'Ana Silva, Ben Okafor, Chloe Park, Dev Rao', 'private'),
      chat('small', 'Ana Silva, Ben Okafor', 'private'),
    ],
    'ana'
  );

  expect(best).toEqual(['small', 'big']);
});

it('leaves folded chats out of the list below', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  expect(featureSearchResults(rows, ['c'], ['b'])).toEqual({
    entities: [{ id: 'c' }, { id: 'a' }, { id: 'd' }],
    featuredIds: ['c'],
  });
});
