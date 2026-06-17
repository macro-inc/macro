import type { AiProjectionResponse } from '@service-storage/generated/schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createComponent, createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    materializeAIProjection: vi.fn(),
  },
}));

import { storageServiceClient } from '@service-storage/client';
import {
  type AIProjectionState,
  createAIProjection,
  createAIProjectionQueryKey,
  target,
} from './createAIProjection';

const materializeAIProjection = vi.mocked(
  storageServiceClient.materializeAIProjection
);

type TestProjectionParams<T = string> = Parameters<
  typeof createAIProjection<T>
>[0];

type TestProjection<T = string> = {
  projection: AIProjectionState<T>;
  queryClient: QueryClient;
  dispose: () => void;
};

function baseParams<T = string>(
  overrides: Partial<TestProjectionParams<T>> = {}
): TestProjectionParams<T> {
  return {
    id: 'inbox/important',
    target: target('user', 'user-1'),
    refreshCadence: 'high',
    prompt: 'Summarize the inbox.',
    ...overrides,
  };
}

function response(
  overrides: Partial<AiProjectionResponse>
): AiProjectionResponse {
  return {
    status: 'ready',
    ...overrides,
  };
}

function createTestProjection<T>(
  params: TestProjectionParams<T>
): TestProjection<T> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry: false,
      },
    },
  });

  let projection: AIProjectionState<T> | undefined;
  const dispose = createRoot((dispose) => {
    createComponent(QueryClientProvider, {
      client: queryClient,
      get children() {
        projection = createAIProjection<T>(params);
        return undefined;
      },
    });

    return dispose;
  });

  if (!projection) {
    throw new Error('Projection was not created');
  }

  return { projection, queryClient, dispose };
}

async function waitForAssertion(assertion: () => void): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 1_000) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  if (lastError) {
    throw lastError;
  }
}

describe('createAIProjectionQueryKey', () => {
  it('is stable and changes when projection definition fields change', () => {
    const params = baseParams({
      context: 'Only unread notifications.',
      schema: { count: 'number', items: ['string'] },
    });
    const stableParams = baseParams({
      context: 'Only unread notifications.',
      schema: { items: ['string'], count: 'number' },
    });

    expect(createAIProjectionQueryKey(params)).toEqual(
      createAIProjectionQueryKey(stableParams)
    );
    expect(createAIProjectionQueryKey(params)).not.toEqual(
      createAIProjectionQueryKey(baseParams({ id: 'tasks/important' }))
    );
    expect(createAIProjectionQueryKey(params)).not.toEqual(
      createAIProjectionQueryKey(
        baseParams({ target: target('team', 'team-1') })
      )
    );
    expect(createAIProjectionQueryKey(params)).not.toEqual(
      createAIProjectionQueryKey(baseParams({ prompt: 'Summarize tasks.' }))
    );
    expect(createAIProjectionQueryKey(params)).not.toEqual(
      createAIProjectionQueryKey(baseParams({ context: 'Only starred items.' }))
    );
    expect(createAIProjectionQueryKey(params)).not.toEqual(
      createAIProjectionQueryKey(baseParams({ schema: { count: 'string' } }))
    );
  });
});

describe('createAIProjection', () => {
  beforeEach(() => {
    materializeAIProjection.mockReset();
  });

  afterEach(() => {
    materializeAIProjection.mockReset();
  });

  it('parses ready timestamps into dates and returns string output by default', async () => {
    materializeAIProjection.mockResolvedValue(
      ok(
        response({
          data: 'Important inbox summary',
          generatedAt: '2026-06-17T16:00:00.000Z',
          staleAt: '2026-06-17T17:00:00.000Z',
        })
      )
    );

    const { projection, dispose } = createTestProjection(baseParams());

    await waitForAssertion(() => {
      expect(projection.ready()).toBe(true);
    });

    expect(projection.data()).toBe('Important inbox summary');
    expect(projection.generatedAt()).toEqual(
      new Date('2026-06-17T16:00:00.000Z')
    );
    expect(projection.staleAt()).toEqual(
      new Date('2026-06-17T17:00:00.000Z')
    );

    dispose();
  });

  it('maps cold responses to cold status without data', async () => {
    materializeAIProjection.mockResolvedValue(
      ok(
        response({
          status: 'cold',
          data: 'Do not show first-load data.',
        })
      )
    );

    const { projection, dispose } = createTestProjection(baseParams());

    await waitForAssertion(() => {
      expect(projection.cold()).toBe(true);
    });

    expect(projection.status()).toBe('cold');
    expect(projection.data()).toBeUndefined();

    dispose();
  });

  it('uses the optional parser to map string output', async () => {
    materializeAIProjection.mockResolvedValue(
      ok(
        response({
          data: '{"count":2}',
        })
      )
    );

    const { projection, dispose } = createTestProjection(
      baseParams<{ count: number }>({
        parser: (data) => JSON.parse(data) as { count: number },
      })
    );

    await waitForAssertion(() => {
      expect(projection.data()).toEqual({ count: 2 });
    });

    dispose();
  });

  it('force refetches with the same definition and updates the query cache', async () => {
    materializeAIProjection
      .mockResolvedValueOnce(
        ok(
          response({
            data: 'cached projection',
          })
        )
      )
      .mockResolvedValueOnce(
        ok(
          response({
            status: 'refreshing',
            data: 'forced projection',
          })
        )
      );

    const params = baseParams({
      context: 'Only unread notifications.',
      expiry: 'day',
      schema: { type: 'string' },
    });
    const { projection, queryClient, dispose } = createTestProjection(params);

    await waitForAssertion(() => {
      expect(projection.data()).toBe('cached projection');
    });

    await projection.refetch();

    expect(materializeAIProjection).toHaveBeenNthCalledWith(1, {
      id: params.id,
      target: params.target,
      prompt: params.prompt,
      refreshCadence: params.refreshCadence,
      context: params.context,
      expiry: params.expiry,
      schema: params.schema,
    });
    expect(materializeAIProjection).toHaveBeenNthCalledWith(2, {
      id: params.id,
      target: params.target,
      prompt: params.prompt,
      refreshCadence: params.refreshCadence,
      context: params.context,
      expiry: params.expiry,
      schema: params.schema,
      forceRefresh: true,
    });
    await waitForAssertion(() => {
      expect(projection.refreshing()).toBe(true);
      expect(projection.data()).toBe('forced projection');
    });
    expect(
      queryClient.getQueryData(createAIProjectionQueryKey(params))
    ).toMatchObject({
      status: 'refreshing',
      data: 'forced projection',
    });

    dispose();
  });
});
