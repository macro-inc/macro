import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import type { Client } from '@urql/core';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fromValue } from 'wonka';

const getGraphqlSoupClient = vi.hoisted(() => vi.fn());

vi.mock('@service-storage/graphql-soup', () => ({ getGraphqlSoupClient }));
vi.mock('@core/context/user', () => ({ useIsAuthenticated: () => () => true }));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: () => true,
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn(), alert: vi.fn() },
}));

import { makeFavoriteAction } from './make-favorite-action';

const doc = { type: 'document', id: 'document-3' } as EntityData;
let mutation: ReturnType<typeof vi.fn>;
let dispose: (() => void) | undefined;

function setFavoriteResponse(extensions?: Record<string, unknown>) {
  return {
    data: {
      setFavorite: {
        __typename: 'SetFavoritePayload',
        result: { __typename: 'GraphqlMutationSuccess' },
        favorite: {
          __typename: 'GraphqlFavorite',
          id: 'document:document-3',
          entityType: 'DOCUMENT',
          entityId: 'document-3',
          sortOrder: 0,
          createdAt: '2026-01-01T00:00:00Z',
          fileType: 'md',
          documentSubType: null,
          channelType: null,
          channelId: null,
        },
      },
    },
    extensions,
  };
}

function renderAction() {
  let action!: ReturnType<typeof makeFavoriteAction>;
  dispose = render(() => {
    action = makeFavoriteAction();
    return null as unknown as JSX.Element;
  }, document.body);
  return action;
}

beforeEach(() => {
  mutation = vi.fn();
  getGraphqlSoupClient.mockReturnValue({
    executeQuery: vi.fn(() =>
      fromValue({
        data: { user: { id: 'macro|user@example.com', favorites: [] } },
      })
    ),
    mutation,
  } as unknown as Client);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  vi.clearAllMocks();
});

it('does not claim success for a favorite that is still queued', async () => {
  mutation.mockReturnValue({
    toPromise: async () =>
      setFavoriteResponse({
        normalizedCacheMutationDisposition: {
          kind: 'queued',
          transactionId: 'transaction-1',
        },
      }),
  });

  await renderAction().execute([doc]);

  expect(mutation).toHaveBeenCalledOnce();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.failure).not.toHaveBeenCalled();
  expect(toast.alert).toHaveBeenCalledOnce();
});

it('confirms a favorite the server committed', async () => {
  mutation.mockReturnValue({
    toPromise: async () => setFavoriteResponse(),
  });

  await renderAction().execute([doc]);

  expect(toast.success).toHaveBeenCalledOnce();
  expect(toast.alert).not.toHaveBeenCalled();
});
