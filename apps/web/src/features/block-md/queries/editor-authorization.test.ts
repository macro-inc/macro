import { Access } from '@macro-inc/collaboration/session/abi.generated';
import { freshContext } from '@queries/storage/documentLoad/offline-context.test-helpers';
import { base64url } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { createEditorAuthorization } from './editor-authorization';

vi.mock('@queries/client', () => ({
  queryClient: {
    getQueryData: () => ({ authenticated: true, id: 'viewer-a' }),
  },
}));

const token = `e30.${base64url.encode(
  JSON.stringify({
    user_id: 'viewer-a',
    document_id: 'doc-1',
    access_level: 'edit',
  })
)}.test-signature`;

describe('native editor account authority', () => {
  it('uses a fresh token on every reconnect and retains a downgraded grant', async () => {
    const getToken = vi.fn(async () => token);
    const { auth, user } = createEditorAuthorization('doc-1', {
      ...freshContext,
      fromCache: true,
      authorization: {
        getToken,
        currentAccess: () => 'view',
        isCurrent: () => true,
        canWrite: () => false,
        onInvalidated: () => () => {},
      },
    });
    expect(user).toBe('viewer-a');
    expect(await auth.token('doc-1')).toEqual({ token, access: Access.Read });
    expect(await auth.token('doc-1')).toEqual({ token, access: Access.Read });
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('rejects an account change during an in-flight token request', async () => {
    let current = true;
    const { auth } = createEditorAuthorization('doc-1', {
      ...freshContext,
      fromCache: true,
      authorization: {
        getToken: async () => {
          current = false;
          return token;
        },
        currentAccess: () => 'view',
        isCurrent: () => current,
        canWrite: () => false,
        onInvalidated: () => () => {},
      },
    });
    await expect(auth.token('doc-1')).rejects.toThrow(
      'Editor authorization changed'
    );
  });

  it('rejects another document before requesting and refuses an unresolved fresh role', async () => {
    const getToken = vi.fn(async () => token);
    const { auth } = createEditorAuthorization('doc-1', {
      ...freshContext,
      fromCache: true,
      authorization: {
        getToken,
        currentAccess: () => undefined,
        isCurrent: () => true,
        canWrite: () => true,
        onInvalidated: () => () => {},
      },
    });
    await expect(auth.token('doc-2')).rejects.toThrow(
      'Editor authorization changed'
    );
    expect(getToken).not.toHaveBeenCalled();
    await expect(auth.token('doc-1')).rejects.toThrow(
      'Editor authorization changed'
    );
  });
});
