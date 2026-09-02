import { describe, expect, it } from 'vitest';
import { authorizeEditRequestIdentity } from './request-identity';

describe('edit endpoint identity policy', () => {
  it('accepts pseudonymous identity only from an authenticated internal caller', () => {
    const opaqueId = `ai-edit:${'a'.repeat(64)}`;
    expect(authorizeEditRequestIdentity(opaqueId, 'shared', 'shared')).toEqual({
      allowed: true,
      pseudonymousUserId: opaqueId,
    });
    expect(authorizeEditRequestIdentity(opaqueId, undefined, 'shared')).toEqual(
      {
        allowed: false,
      }
    );
    expect(authorizeEditRequestIdentity(opaqueId, 'wrong', 'shared')).toEqual({
      allowed: false,
    });
    expect(authorizeEditRequestIdentity(opaqueId, '', '')).toEqual({
      allowed: false,
    });
  });

  it('keeps browser requests compatible and unattributed', () => {
    expect(
      authorizeEditRequestIdentity(undefined, undefined, 'shared')
    ).toEqual({ allowed: true });
  });
});
