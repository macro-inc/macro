import type { MutationSettlement } from '@graphql-cache/protocol';
import { onlineManager } from '@tanstack/solid-query';
import { CombinedError, type OperationResult } from '@urql/core';
import { version as uuidVersion, validate as validateUuid } from 'uuid';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const soup = vi.hoisted(() => ({
  result: undefined as Partial<OperationResult> | undefined,
  mutation: vi.fn(),
  host: undefined as
    | {
        onMutationSettled: (
          listener: (settlement: MutationSettlement) => void
        ) => () => void;
        onCacheGenerationChanged: () => () => void;
      }
    | undefined,
  settle: (_settlement: MutationSettlement) => {},
  optimistic: vi.fn(),
}));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({
    mutation: soup.mutation,
    query: () => ({ toPromise: async () => ({ data: undefined }) }),
  }),
  getGraphqlSoupCacheHost: () => soup.host,
}));

vi.mock('@graphql-cache/index', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@graphql-cache/index')>()),
  executeOptimisticMutation: soup.optimistic,
  optimisticMutationDispositionOf: (result: { queued?: string }) =>
    result.queued
      ? { kind: 'queued', transactionId: result.queued }
      : undefined,
}));

import { isCatalogErrorCode } from './errors';
import { addPropertyOption, deletePropertyOption } from './writes';

const TAG = {
  type: 'select_string',
  option: { value: 'Lead', display_order: 0, color: '#f00' },
} as const;

beforeEach(() => {
  soup.host = undefined;
  soup.mutation.mockReset();
  soup.mutation.mockImplementation(() => ({
    toPromise: async () => soup.result,
  }));
  soup.optimistic.mockReset();
});

/** A cache host whose queue holds every write until the test settles it. */
function queueingHost() {
  const listeners = new Set<(settlement: MutationSettlement) => void>();
  soup.host = {
    onMutationSettled(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onCacheGenerationChanged: () => () => {},
  };
  soup.optimistic.mockImplementation(() => ({
    toPromise: async () => ({ queued: 'tx-1' }),
  }));
  return (settlement: MutationSettlement) => {
    for (const listener of [...listeners]) listener(settlement);
  };
}

describe('adding an option', () => {
  it('sends an id minted here and answers with the option made under it', async () => {
    soup.result = {
      data: {
        addPropertyOption: {
          __typename: 'GraphqlPropertyOption',
          id: 'sent',
          propertyDefinitionId: 'def-1',
          displayOrder: 0,
          value: {
            __typename: 'GraphqlStringPropertyOptionValue',
            stringValue: 'Lead',
          },
          color: '#f00',
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      },
    };
    const created = await addPropertyOption('def-1', TAG);
    const [, variables] = soup.mutation.mock.calls[0] ?? [];
    expect(validateUuid(variables.input.id)).toBe(true);
    expect(uuidVersion(variables.input.id)).toBe(7);
    expect(variables.input).toMatchObject({
      propertyDefinitionId: 'def-1',
      value: { string: 'Lead' },
    });
    expect(created.id).toBe('sent');
  });

  it('shows a queued add under its id and resolves only once it commits', async () => {
    const settle = queueingHost();
    let resolved = false;
    const added = addPropertyOption('def-1', TAG).then((option) => {
      resolved = true;
      return option;
    });
    await vi.waitFor(() => expect(soup.optimistic).toHaveBeenCalled());
    const [, , variables, response, options] =
      soup.optimistic.mock.calls[0] ?? [];
    const sent = variables.input.id;
    // The local record is the one the cache shows and links into lists.
    expect(response.addPropertyOption.id).toBe(sent);
    expect(options.uuid).toBe(sent);
    await Promise.resolve();
    expect(resolved).toBe(false);
    settle({ transactionId: 'tx-1', status: 'committed' });
    const option = await added;
    expect(option).toMatchObject({
      id: sent,
      property_definition_id: 'def-1',
      value: { type: 'string', value: 'Lead' },
    });
  });

  it('rejects a queued add the server refuses later', async () => {
    const settle = queueingHost();
    const added = addPropertyOption('def-1', TAG).catch(
      (error: unknown) => error
    );
    await vi.waitFor(() => expect(soup.optimistic).toHaveBeenCalled());
    await Promise.resolve();
    settle({
      transactionId: 'tx-1',
      status: 'permanently-failed',
      error: 'refused',
    });
    expect(await added).toBeInstanceOf(Error);
  });

  it('names a refusal made before GraphQL by its HTTP status class', async () => {
    for (const [status, code] of [
      [401, 'UNAUTHENTICATED'],
      [403, 'FORBIDDEN'],
    ] as const) {
      soup.result = {
        error: new CombinedError({
          networkError: new Error('refused'),
          response: { status },
        }),
      };
      const refusal = await addPropertyOption('def-1', TAG).catch(
        (error: unknown) => error
      );
      expect(isCatalogErrorCode(refusal, code)).toBe(true);
    }
  });
});

describe('a write started offline', () => {
  it('waits for the app to come online when the server answers it', async () => {
    onlineManager.setOnline(false);
    try {
      soup.result = { data: { deletePropertyOption: true } };
      const deleted = deletePropertyOption('def-1', 'opt-1', () => {});
      await Promise.resolve();
      await Promise.resolve();
      expect(soup.mutation).not.toHaveBeenCalled();
      onlineManager.setOnline(true);
      await deleted;
      expect(soup.mutation).toHaveBeenCalledTimes(1);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('goes to the cache queue at once when the cache predicts it', async () => {
    onlineManager.setOnline(false);
    try {
      queueingHost();
      // the queue never settles it here, so the test does not wait for it
      const added = addPropertyOption('def-1', TAG);
      await vi.waitFor(() => expect(soup.optimistic).toHaveBeenCalled());
      expect(added).toBeInstanceOf(Promise);
    } finally {
      onlineManager.setOnline(true);
    }
  });
});
