import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

import type { UseQueryResult } from '@tanstack/solid-query';
import { queryClient } from '@queries/client';
import { neverSuspendQuery } from './never-suspend';

const KEY = ['notification', 'preferences'] as const;
const FALLBACK = { disabled_types: [] as string[] };

function fakeQuery(): UseQueryResult<typeof FALLBACK, Error> {
  return { dataUpdatedAt: 1 } as UseQueryResult<typeof FALLBACK, Error>;
}

describe('neverSuspendQuery', () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it('returns the fallback when the cache is empty', () => {
    const wrapped = neverSuspendQuery(fakeQuery(), KEY, FALLBACK);
    expect(wrapped.data).toEqual(FALLBACK);
  });

  it('returns cache data after a write, including after the cache was cleared', () => {
    queryClient.setQueryData(KEY, { disabled_types: ['ai_response'] });
    const wrapped = neverSuspendQuery(fakeQuery(), KEY, FALLBACK);
    expect(wrapped.data).toEqual({ disabled_types: ['ai_response'] });

    queryClient.setQueryData(KEY, undefined);
    expect(wrapped.data).toEqual(FALLBACK);
  });
});
