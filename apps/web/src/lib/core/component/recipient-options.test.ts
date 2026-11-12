import type { CombinedRecipientItem } from '@core/user/combinedRecipient';
import { expect, it } from 'vitest';
import { uniqueRecipientMatches } from './recipient-options';

const USER: CombinedRecipientItem<'user'> = {
  kind: 'user',
  id: 'macro|person@example.com',
  data: {
    id: 'macro|person@example.com',
    email: 'person@example.com',
    name: 'Directory name',
  },
};
const THREAD: CombinedRecipientItem<'contact'> = {
  kind: 'contact',
  id: 'thread-person',
  data: {
    id: 'thread-person',
    type: 'extracted',
    email: 'PERSON@example.com',
    name: 'Thread name',
  },
};

it('deduplicates ranked directory/scoped matches by canonical address without losing the winning alias', () => {
  expect(uniqueRecipientMatches([USER, THREAD])).toEqual([USER]);
  expect(uniqueRecipientMatches([THREAD, USER])).toEqual([THREAD]);
});

it('keeps the selected representation when a custom address becomes a directory match', () => {
  const custom: CombinedRecipientItem<'custom'> = {
    kind: 'custom',
    id: USER.id,
    data: { id: USER.id, email: 'person@example.com', invalid: false },
  };
  const matched = uniqueRecipientMatches<CombinedRecipientItem>(
    [USER, THREAD, custom],
    [custom]
  );
  expect(matched).toEqual([custom]);
  expect(matched[0]).toBe(custom);
  expect(USER.data.name).toBe('Directory name');
});
