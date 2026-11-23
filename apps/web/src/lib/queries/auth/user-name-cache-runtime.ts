import { Telemetry } from '@macro-inc/observability';
import { authServiceClient } from '@service-auth/client';
import { resetMacroApiToken } from '@service-auth/fetch';
import type { QueryClient } from '@tanstack/solid-query';
import { untrack } from 'solid-js';
import { queryClient } from '../client';
import {
  assertQueryAccount,
  currentQueryAccount,
  type QueryAccount,
} from './account-scope';
import {
  createUserNameCache,
  UserNameAccessError,
  type UserNameCache,
} from './user-name-cache';

async function fetchNames(
  account: QueryAccount,
  ids: string[],
  queueWaitMs: number,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  assertQueryAccount(account);
  const span = Telemetry.span('contacts.names.read', { kind: 'client' });
  const headers: Record<string, string> = {};
  span.injectTraceHeaders(headers);
  span.setAttr('contacts.name_count', ids.length);
  span.setAttr('contacts.queue_wait_ms', queueWaitMs);
  try {
    const result = await span.run(() =>
      authServiceClient.getUserNamesWithEmail(
        { user_ids: ids },
        { headers, trace: { parentSpan: span }, signal }
      )
    );
    signal.throwIfAborted();
    assertQueryAccount(account);
    if (result.isErr()) {
      if (
        result.error.some(
          (error) => error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN'
        )
      )
        throw new UserNameAccessError();
      throw new Error('Names unavailable');
    }
    span.setAttr('contacts.result_count', result.value.names.length);
    span.setAttr('contacts.outcome', 'success');
    return result.value.names;
  } catch (error) {
    span.setAttr('contacts.outcome', 'failed-or-canceled');
    span.error('Name lookup did not complete');
    throw error;
  } finally {
    span.end();
  }
}

// One controller for the existing application QueryClient. It initializes lazily,
// without inheriting the first label's Solid owner or starting an auth request.
const runtimes = new WeakMap<QueryClient, UserNameCache>();
export function userNameCache(): UserNameCache {
  return untrack(() => {
    const existing = runtimes.get(queryClient);
    if (existing) return existing;
    const cache = createUserNameCache({
      client: queryClient,
      account: currentQueryAccount,
      fetch: fetchNames,
      onScopeChange: resetMacroApiToken,
    });
    runtimes.set(queryClient, cache);
    return cache;
  });
}
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    runtimes.get(queryClient)?.dispose();
    runtimes.delete(queryClient);
  });
