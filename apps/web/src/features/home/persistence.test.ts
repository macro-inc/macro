import { describe, expect, it } from 'vitest';
import { normalizeHomeFacets } from './persistence';

describe('normalizeHomeFacets', () => {
  it('renames saved type ids their options moved away from', () => {
    expect(
      normalizeHomeFacets({ type: ['chats', 'projects', 'email'] }).type
    ).toEqual(['agents', 'email', 'folders']);
  });

  it('keeps current ids as they are', () => {
    expect(
      normalizeHomeFacets({ type: ['folders', 'initiatives'] }).type
    ).toEqual(['folders', 'initiatives']);
  });

  it('drops a read filter that is not exactly one of unread or read', () => {
    expect(normalizeHomeFacets({ read: ['unread', 'read'] }).read).toBe(
      undefined
    );
    expect(normalizeHomeFacets({ read: ['read'] }).read).toEqual(['read']);
  });
});
