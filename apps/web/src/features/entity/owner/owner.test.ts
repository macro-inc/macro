import { describe, expect, it } from 'vitest';
import { botOwnerName, parseOwner } from './owner';

const BOT_ID = '5f0c8a4e-2d1b-4c3a-9e7f-6a5b4c3d2e1f';
const TEAM_ID = '01234567-89ab-cdef-0123-456789abcdef';
const MACRO_BOT_ID = '00000000-0000-0000-0000-00000000a1a1';

describe('parseOwner', () => {
  it.each([
    {
      principal: 'macro|sarah@example.com',
      owner: { kind: 'user', id: 'macro|sarah@example.com' },
    },
    { principal: `bot|${BOT_ID}`, owner: { kind: 'bot', botId: BOT_ID } },
    {
      principal: `bot|${MACRO_BOT_ID}`,
      owner: { kind: 'bot', botId: MACRO_BOT_ID },
    },
    {
      principal: 'bot|not-a-uuid',
      owner: { kind: 'unknown', raw: 'bot|not-a-uuid' },
    },
    { principal: MACRO_BOT_ID, owner: { kind: 'bot', botId: MACRO_BOT_ID } },
    { principal: TEAM_ID, owner: { kind: 'team', teamId: TEAM_ID } },
    {
      principal: 'system:nightly',
      owner: { kind: 'unknown', raw: 'system:nightly' },
    },
  ])('parses $principal', ({ principal, owner }) => {
    expect(parseOwner(principal)).toEqual(owner);
  });

  it('has no owner for an empty or missing principal, unlike a blank one', () => {
    expect(parseOwner('')).toBeUndefined();
    expect(parseOwner(undefined)).toBeUndefined();
    expect(parseOwner(' ')).toEqual({ kind: 'unknown', raw: ' ' });
  });
});

describe('botOwnerName', () => {
  it('suffixes a deleted bot', () => {
    expect(botOwnerName({ name: 'Deploy Bot', deleted: true })).toBe(
      'Deploy Bot (deleted)'
    );
  });

  it('keeps a live bot name as is', () => {
    expect(botOwnerName({ name: 'Deploy Bot', deleted: false })).toBe(
      'Deploy Bot'
    );
  });
});
