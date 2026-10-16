import { QueryClient, QueryObserver } from '@tanstack/query-core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  clearSavedDraftThreadCache,
  markThreadDraftSaved,
} from './draft-cache';
import { emailKeys } from './keys';

vi.mock('../client', () => ({
  get queryClient() {
    return client;
  },
}));

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient();
});

afterEach(() => {
  clearSavedDraftThreadCache('thread');
  client.clear();
});

it('evicts inactive messages when a save finishes after thread cleanup', () => {
  const key = emailKeys.threadMessages('thread').queryKey;
  const otherKey = emailKeys.threadMessages('other-thread').queryKey;
  const metadataKey = emailKeys.thread('thread').queryKey;
  client.setQueryData(key, { body: 'Old draft' });
  client.setQueryData(otherKey, { body: 'Other draft' });
  client.setQueryData(metadataKey, { subject: 'Subject' });
  clearSavedDraftThreadCache('thread');

  markThreadDraftSaved('thread');

  expect(client.getQueryState(key)).toBeUndefined();
  expect(client.getQueryData(otherKey)).toEqual({ body: 'Other draft' });
  expect(client.getQueryData(metadataKey)).toEqual({ subject: 'Subject' });
});

it('preserves active messages and their state until thread cleanup', () => {
  const key = emailKeys.threadMessages('thread').queryKey;
  const data = { body: 'Visible draft' };
  client.setQueryData(key, data);
  const fetch = vi.fn(async () => data);
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: fetch,
    staleTime: Infinity,
  });
  const changed = vi.fn();
  const unsubscribe = observer.subscribe(changed);
  const query = client.getQueryCache().find({ queryKey: key });
  const state = client.getQueryState(key);

  markThreadDraftSaved('thread');
  markThreadDraftSaved('thread');

  expect(client.getQueryCache().find({ queryKey: key })).toBe(query);
  expect(client.getQueryState(key)).toBe(state);
  expect(client.getQueryData(key)).toBe(data);
  expect(changed).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();

  unsubscribe();
  clearSavedDraftThreadCache('thread');
  expect(client.getQueryState(key)).toBeUndefined();
});
