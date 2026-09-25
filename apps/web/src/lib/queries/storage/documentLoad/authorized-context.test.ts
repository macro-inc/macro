import { base64url } from 'jose';
import { describe, expect, it } from 'vitest';
import { authorizedContext } from './authorized-context';
import { freshContext } from './offline-context.test-helpers';

const session = { userId: 'viewer-a', epoch: 'login-1', generation: 0 };
const claims = {
  user_id: session.userId,
  document_id: 'doc-1',
  access_level: 'edit',
};
const token = (payload: unknown) =>
  `e30.${base64url.encode(JSON.stringify(payload))}.test-signature`;

describe('fresh document authorization binding', () => {
  it('accepts the current user and document', () => {
    expect(
      authorizedContext('doc-1', session, {
        ...freshContext,
        token: token(claims),
      }).userAccessLevel
    ).toBe('edit');
  });

  it.each([
    { ...claims, user_id: 'another-viewer' },
    { ...claims, document_id: 'another-document' },
    { ...claims, user_id: null },
    { ...claims, access_level: 'admin' },
  ])('rejects a mismatched or unbound token', (payload) => {
    expect(() =>
      authorizedContext('doc-1', session, {
        ...freshContext,
        token: token(payload),
      })
    ).toThrow('Document authorization does not match');
  });

  it('rejects malformed tokens and metadata for a different document', () => {
    expect(() => authorizedContext('doc-1', session, freshContext)).toThrow();
    expect(() =>
      authorizedContext('doc-1', session, {
        ...freshContext,
        token: token(claims),
        documentMetadata: {
          ...freshContext.documentMetadata,
          documentId: 'other',
        },
      })
    ).toThrow();
  });

  it('keeps the more restrictive grant when authorization changes between requests', () => {
    expect(
      authorizedContext('doc-1', session, {
        ...freshContext,
        token: token({ ...claims, access_level: 'view' }),
      }).userAccessLevel
    ).toBe('view');
    expect(
      authorizedContext('doc-1', session, {
        ...freshContext,
        userAccessLevel: 'comment',
        token: token({ ...claims, access_level: 'owner' }),
      }).userAccessLevel
    ).toBe('comment');
  });
});
