import { onlineManager, QueryClient } from '@tanstack/query-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSoupRequestSignal,
  SOUP_NETWORK_QUERY_OPTIONS,
  SOUP_REQUEST_TIMEOUT_MS,
} from './request-timeout';

describe('createSoupRequestSignal', () => {
  afterEach(() => onlineManager.setOnline(true));

  it('aborts when TanStack cancels the query', () => {
    const query = new AbortController();
    const signal = createSoupRequestSignal(query.signal);

    query.abort();

    expect(signal.aborted).toBe(true);
  });

  it('uses the bounded Soup request deadline', () => {
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);

    createSoupRequestSignal(new AbortController().signal);

    expect(timeout).toHaveBeenCalledWith(SOUP_REQUEST_TIMEOUT_MS);
    timeout.mockRestore();
  });

  it('pauses while offline and resumes when connectivity returns', async () => {
    onlineManager.setOnline(false);
    const queryFn = vi.fn(async () => 'loaded');
    const queryClient = new QueryClient();
    queryClient.mount();
    const result = queryClient.fetchQuery({
      queryKey: ['soup', 'offline-transition'],
      queryFn,
      ...SOUP_NETWORK_QUERY_OPTIONS,
    });

    await Promise.resolve();
    expect(queryFn).not.toHaveBeenCalled();

    onlineManager.setOnline(true);

    await expect(result).resolves.toBe('loaded');
    expect(queryFn).toHaveBeenCalledOnce();
    queryClient.unmount();
  });
});
