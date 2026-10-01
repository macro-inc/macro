import { describe, expect, it } from 'vitest';
import { activeChannelsTab } from './utils';

describe('activeChannelsTab', () => {
  it('shows All for a stored Threads tab while the flag is off or loading', () => {
    expect(activeChannelsTab('threads', false)).toBe('browse');
  });

  it('shows Threads once the flag is on', () => {
    expect(activeChannelsTab('threads', true)).toBe('threads');
  });

  it('leaves the other tabs alone', () => {
    expect(activeChannelsTab('recents', false)).toBe('recents');
    expect(activeChannelsTab('browse', false)).toBe('browse');
  });
});
