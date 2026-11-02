import { describe, expect, it } from 'vitest';
import { peerAuthorId } from './author';
import { userLabel } from './utils';

describe('peerAuthorId', () => {
  it('attributes a peer an agent registered to the agent', () => {
    expect(
      peerAuthorId('11646767255883251712', {
        userId: 'macro|wolf@macro.com',
        actor: 'bot|0198c1a2-7b3c-7d4e-8f90-123456789abc',
      })
    ).toBe('bot|0198c1a2-7b3c-7d4e-8f90-123456789abc');
  });

  it('attributes an AI peer without an agent to the user, marked as AI', () => {
    expect(
      peerAuthorId('11646767255883251712', {
        userId: 'macro|wolf@macro.com',
        actor: null,
      })
    ).toBe('ai|macro|wolf@macro.com');
    expect(userLabel('ai|macro|wolf@macro.com')).toBe('wolf@macro.com (AI)');
  });

  it('still recognizes AI peers from the legacy reserved block', () => {
    expect(
      peerAuthorId('999999999999999000', {
        userId: 'macro|wolf@macro.com',
        actor: null,
      })
    ).toBe('ai|macro|wolf@macro.com');
  });

  it('attributes a human peer to its user', () => {
    expect(
      peerAuthorId('4242424242', {
        userId: 'macro|wolf@macro.com',
        actor: null,
      })
    ).toBe('macro|wolf@macro.com');
    expect(peerAuthorId('4242424242', undefined)).toBe('unknown');
  });

  it('falls back to Macro for an AI peer with no record', () => {
    expect(peerAuthorId('11646767255883251712', undefined)).toBe(
      '00000000-0000-0000-0000-00000000a1a1'
    );
  });
});
