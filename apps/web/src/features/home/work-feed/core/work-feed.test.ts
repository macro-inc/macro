import { describe, expect, it } from 'vitest';
import {
  markWorkFeedDone,
  settleWorkFeedDone,
  unmarkWorkFeedDone,
  type WorkFeedEntry,
  withoutDoneWorkFeedEntries,
} from './work-feed';

function entry(
  itemId: string,
  sortAt: number,
  revision = `rev-${itemId}`
): WorkFeedEntry {
  return {
    itemId,
    revision,
    sortAt,
    state: 'unseen',
    primaryReason: 'attention',
    hasAttention: true,
    hasOwnWork: false,
    entity: { type: 'document', id: itemId } as WorkFeedEntry['entity'],
  };
}

const ids = (entries: WorkFeedEntry[]) => entries.map((e) => e.itemId);

describe('work feed done', () => {
  it('hides an item while the feed shows the acknowledged revision', () => {
    const done = markWorkFeedDone(new Map(), [
      { itemId: 'a', revision: 'rev-a' },
    ]);
    expect(ids(withoutDoneWorkFeedEntries([entry('a', 5)], done))).toEqual([]);
    // A reason that arrived after the done brings it back.
    expect(
      ids(withoutDoneWorkFeedEntries([entry('a', 6, 'rev-a-2')], done))
    ).toEqual(['a']);
    expect(
      ids(
        withoutDoneWorkFeedEntries(
          [entry('a', 5)],
          unmarkWorkFeedDone(done, ['a'])
        )
      )
    ).toEqual(['a']);
  });

  it('forgets items a fresh read settled', () => {
    const done = markWorkFeedDone(new Map(), [
      { itemId: 'gone', revision: 'rev-gone' },
      { itemId: 'newer', revision: 'rev-newer' },
      { itemId: 'pending', revision: 'rev-pending' },
    ]);
    const settled = settleWorkFeedDone(done, [
      entry('newer', 9, 'rev-newer-2'),
      entry('pending', 4),
    ]);
    expect([...settled.keys()]).toEqual(['pending']);
  });
});
