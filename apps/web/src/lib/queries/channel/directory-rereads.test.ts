import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addChannelRereads,
  DELETE_IN_FLIGHT_MS,
  endChannelRereadDelete,
  type OwedRereads,
  owedChannelRereads,
  pendingChannelRereads,
  settleChannelRereads,
} from './directory-rereads';

/** Owes `ids` and lets their delete answer, as a caller does. */
function deleted(user: string, generation: string, ids: string[]) {
  const owed = addChannelRereads(user, generation, ids);
  if (!owed) throw new Error('storage refused');
  endChannelRereadDelete(user, generation, owed);
  return owed;
}

describe('channel rereads owed after a delete', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps what is owed until it is settled', () => {
    deleted('viewer', 'g1', ['a', 'b']);
    deleted('viewer', 'g1', ['b', 'c']);

    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['a', 'b', 'c']);

    settleChannelRereads('viewer', 'g1', owedChannelRereads('viewer', 'g1'));
    expect(pendingChannelRereads('viewer', 'g1')).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it('settles only the deletes it read for', () => {
    const first = deleted('viewer', 'g1', ['a', 'b']);
    const second = deleted('viewer', 'g1', ['b', 'c']);

    // `b` was owed again after the first read was sent: that read says
    // nothing about the second delete.
    settleChannelRereads('viewer', 'g1', first);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['b', 'c']);

    settleChannelRereads('viewer', 'g1', second);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual([]);
  });

  it('keeps one caller from settling what another owes', () => {
    deleted('viewer', 'g1', ['owed']);
    const cleanup = deleted('viewer', 'g1', ['gone']);

    settleChannelRereads('viewer', 'g1', cleanup);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['owed']);
  });

  it('offers no read for a delete still in flight, so none can settle it', () => {
    const cleanup = addChannelRereads('viewer', 'g1', ['rejoined']);
    if (!cleanup) throw new Error('storage refused');

    // A lane passes while the delete is pending: the channel stays owed, and
    // nothing the lane reads now can settle it.
    const lane = owedChannelRereads('viewer', 'g1');
    expect(lane).toEqual({});
    settleChannelRereads('viewer', 'g1', lane);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['rejoined']);

    endChannelRereadDelete('viewer', 'g1', cleanup);
    expect(owedChannelRereads('viewer', 'g1')).toEqual(cleanup);
  });

  it('leaves out another tab’s delete until its deadline, then reads it', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    // Owed by a tab that closed before its delete answered: only the stored
    // deadline remains.
    localStorage.setItem(
      'channel-directory-rereads:v4:viewer',
      JSON.stringify({
        g1: {
          touched: Date.now(),
          owed: { a: [{ mark: 'm', deletingUntil: Date.now() + 1 }] },
        },
      })
    );
    expect(owedChannelRereads('viewer', 'g1')).toEqual({});

    vi.setSystemTime(Date.now() + DELETE_IN_FLIGHT_MS);
    expect(owedChannelRereads('viewer', 'g1')).toEqual({ a: ['m'] });
  });

  it('ends only the delete it names', () => {
    const first = addChannelRereads('viewer', 'g1', ['a']);
    const second = addChannelRereads('viewer', 'g1', ['b']);
    if (!first || !second) throw new Error('storage refused');

    endChannelRereadDelete('viewer', 'g1', first);
    expect(owedChannelRereads('viewer', 'g1')).toEqual(first);
  });

  it('keeps a channel owed again mid-delete in flight until both deletes answer', () => {
    const first = addChannelRereads('viewer', 'g1', ['a']);
    const second = addChannelRereads('viewer', 'g1', ['a']);
    if (!first || !second) throw new Error('storage refused');

    endChannelRereadDelete('viewer', 'g1', first);
    expect(owedChannelRereads('viewer', 'g1')).toEqual({});
    endChannelRereadDelete('viewer', 'g1', second);
    expect(owedChannelRereads('viewer', 'g1')).toEqual({
      a: [...(first.a ?? []), ...(second.a ?? [])],
    });
  });

  it('keeps an earlier delete owed when a later one of the channel answers and settles first', () => {
    // Delete A is pending; delete B of the same channel answers, its own read
    // writes the channel back and settles B. A can still land and erase that
    // record, so A stays owed, in flight, and is read once it answers.
    const first = addChannelRereads('viewer', 'g1', ['a']);
    const second = addChannelRereads('viewer', 'g1', ['a']);
    if (!first || !second) throw new Error('storage refused');

    endChannelRereadDelete('viewer', 'g1', second);
    settleChannelRereads('viewer', 'g1', second);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['a']);
    expect(owedChannelRereads('viewer', 'g1')).toEqual({});

    endChannelRereadDelete('viewer', 'g1', first);
    const lane = owedChannelRereads('viewer', 'g1');
    expect(lane).toEqual(first);
    settleChannelRereads('viewer', 'g1', lane);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual([]);
  });

  it('keeps each viewer apart', () => {
    deleted('viewer', 'g1', ['a']);
    deleted('other', 'g1', ['b']);

    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['a']);
    expect(pendingChannelRereads('other', 'g1')).toEqual(['b']);
  });

  it('owes nothing to another storage generation', () => {
    const owed: OwedRereads = deleted('viewer', 'g1', ['a']);

    expect(pendingChannelRereads('viewer', 'g2')).toEqual([]);
    settleChannelRereads('viewer', 'g2', owed);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['a']);

    deleted('viewer', 'g2', ['b']);
    expect(pendingChannelRereads('viewer', 'g2')).toEqual(['b']);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['a']);
  });

  it('keeps a newer generation when a pass of an older one owes afterwards', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    deleted('viewer', 'new', ['b']);
    vi.setSystemTime(Date.now() + 1);
    deleted('viewer', 'old', ['a']);

    expect(pendingChannelRereads('viewer', 'new')).toEqual(['b']);
    expect(pendingChannelRereads('viewer', 'old')).toEqual(['a']);
  });

  it('keeps only the generations written to most recently', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    for (const generation of Array.from(
      { length: 17 },
      (_, i) => `g${i + 1}`
    )) {
      deleted('viewer', generation, [generation]);
      vi.setSystemTime(Date.now() + 1);
    }

    expect(pendingChannelRereads('viewer', 'g1')).toEqual([]);
    expect(pendingChannelRereads('viewer', 'g17')).toEqual(['g17']);
    expect(pendingChannelRereads('viewer', 'g2')).toEqual(['g2']);
  });

  it('keeps the generation it owes in, whatever other tabs stamped the rest', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    // Another tab, its clock ahead of this one's, wrote three generations.
    const ahead = (mark: string) => ({
      touched: Date.now() + 60_000,
      owed: { [mark]: [{ mark }] },
    });
    localStorage.setItem(
      'channel-directory-rereads:v4:viewer',
      JSON.stringify({ g1: ahead('a'), g2: ahead('b'), g3: ahead('c') })
    );

    const owed = addChannelRereads('viewer', 'g4', ['d']);
    expect(owed).toBeDefined();
    expect(pendingChannelRereads('viewer', 'g4')).toEqual(['d']);
  });

  it('keeps a generation that owes when an older pass owes after it', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    // Another tab, its clock ahead of this one's, wrote two generations.
    const ahead = (mark: string) => ({
      touched: Date.now() + 60_000,
      owed: { [mark]: [{ mark }] },
    });
    localStorage.setItem(
      'channel-directory-rereads:v4:viewer',
      JSON.stringify({ g1: ahead('a'), g2: ahead('b') })
    );

    deleted('viewer', 'g4', ['d']);
    deleted('viewer', 'g3', ['c']);

    expect(pendingChannelRereads('viewer', 'g4')).toEqual(['d']);
    expect(pendingChannelRereads('viewer', 'g3')).toEqual(['c']);
  });

  it('ignores what it cannot read back', () => {
    localStorage.setItem('channel-directory-rereads:v4:viewer', '{"ids":3}');

    expect(pendingChannelRereads('viewer', 'g1')).toEqual([]);
  });

  it('says when storage refused what is owed, and keeps nothing of it', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });

    expect(addChannelRereads('viewer', 'g1', ['a'])).toBeUndefined();
    expect(pendingChannelRereads('viewer', 'g1')).toEqual([]);

    setItem.mockRestore();
    expect(addChannelRereads('viewer', 'g1', ['b'])).toBeDefined();
    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['b']);
  });
});
