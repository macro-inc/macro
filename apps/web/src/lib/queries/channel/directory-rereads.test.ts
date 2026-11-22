import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addChannelRereads,
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

    settleChannelRereads('viewer', 'g1', ['a', 'c']);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['b']);

    settleChannelRereads('viewer', 'g1', ['b']);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it('keeps each viewer apart', () => {
    addChannelRereads('viewer', 'g1', ['a']);
    addChannelRereads('other', 'g1', ['b']);

    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['a']);
    expect(pendingChannelRereads('other', 'g1')).toEqual(['b']);
  });

  it('owes nothing to another storage generation, and drops the old one on the next delete', () => {
    addChannelRereads('viewer', 'g1', ['a']);

    expect(pendingChannelRereads('viewer', 'g2')).toEqual([]);
    settleChannelRereads('viewer', 'g2', ['a']);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['a']);

    addChannelRereads('viewer', 'g2', ['b']);
    expect(pendingChannelRereads('viewer', 'g2')).toEqual(['b']);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual([]);
  });

  it('ignores what it cannot read back', () => {
    localStorage.setItem('channel-directory-rereads:v1:viewer', '{"ids":3}');

    expect(pendingChannelRereads('viewer', 'g1')).toEqual([]);
  });

  it('says when storage refused what is owed, and keeps nothing of it', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });

    expect(addChannelRereads('viewer', 'g1', ['a'])).toBe(false);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual([]);

    setItem.mockRestore();
    expect(addChannelRereads('viewer', 'g1', ['b'])).toBe(true);
    expect(pendingChannelRereads('viewer', 'g1')).toEqual(['b']);
  });
});
