import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addChannelRereads,
  owedChannelRereads,
  pendingChannelRereads,
  settleChannelRereads,
} from './directory-rereads';

describe('channel rereads owed after a delete', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps what is owed until it is settled', () => {
    addChannelRereads('viewer', 'g1', ['a', 'b']);
    addChannelRereads('viewer', 'g1', ['b', 'c']);

    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['a', 'b', 'c']);

    settleChannelRereads('viewer', 'g1', owedChannelRereads('viewer', 'g1'));
    expect(pendingChannelRereads('viewer', 'g1')).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it('settles only the deletes it read for', () => {
    const first = addChannelRereads('viewer', 'g1', ['a', 'b']);
    const second = addChannelRereads('viewer', 'g1', ['b', 'c']);
    if (!first || !second) throw new Error('storage refused');

    // `b` was owed again after the first read was sent: that read says
    // nothing about the second delete.
    settleChannelRereads('viewer', 'g1', first);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['b', 'c']);

    settleChannelRereads('viewer', 'g1', second);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual([]);
  });

  it('keeps one caller from settling what another owes', () => {
    const lane = addChannelRereads('viewer', 'g1', ['owed']);
    const cleanup = addChannelRereads('viewer', 'g1', ['gone']);
    if (!lane || !cleanup) throw new Error('storage refused');

    settleChannelRereads('viewer', 'g1', cleanup);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['owed']);
  });

  it('keeps each viewer apart', () => {
    addChannelRereads('viewer', 'g1', ['a']);
    addChannelRereads('other', 'g1', ['b']);

    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['a']);
    expect(pendingChannelRereads('other', 'g1')).toEqual(['b']);
  });

  it('owes nothing to another storage generation, and drops the old one on the next delete', () => {
    const owed = addChannelRereads('viewer', 'g1', ['a']);
    if (!owed) throw new Error('storage refused');

    expect(pendingChannelRereads('viewer', 'g2')).toEqual([]);
    settleChannelRereads('viewer', 'g2', owed);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['a']);

    addChannelRereads('viewer', 'g2', ['b']);
    expect(pendingChannelRereads('viewer', 'g2')).toEqual(['b']);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual([]);
  });

  it('ignores what it cannot read back', () => {
    localStorage.setItem('channel-directory-rereads:v2:viewer', '{"ids":3}');

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
