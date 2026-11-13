import { scheduledActionKeys } from '@app/features/routines/queries/keys';
import { thrownResultErrorHasCode } from '@core/util/result';
import { resetMacroApiToken } from '@service-auth/fetch';
import {
  hashKey,
  type MutationFunctionContext,
  partialMatchKey,
} from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { channelKeys } from '../channel/keys';
import { queryClient } from '../client';
import { emailKeys } from '../email/keys';
import { authKeys } from './keys';

const ACCOUNT_SOURCE_PREFIXES = [
  channelKeys.listChannels._def,
  channelKeys.activity._def,
  channelKeys.quickAccessGraphql._def,
  emailKeys.links._def,
  emailKeys.linksHealthProbe._def,
  authKeys.userNameSelf._def,
  scheduledActionKeys.draftJobs.queryKey,
];

/** Captured before async work; a new login fences even a return to the same account. */
export type QueryAccount = { userId: string; session: number };
const [session, setSession] = createSignal({ epoch: 0, pending: false });
let stopWaitingForIdentity: (() => void) | undefined;

export class QueryAccountChangedError extends Error {
  constructor() {
    super('Query account changed');
  }
}

export function captureQueryAccount(
  userId: string | undefined
): QueryAccount | undefined {
  const current = session();
  return userId && !current.pending
    ? { userId, session: current.epoch }
    : undefined;
}

export function queryAccountSessionPending(): boolean {
  return session().pending;
}

export function currentQueryAccount(): QueryAccount | undefined {
  if (
    thrownResultErrorHasCode(
      queryClient.getQueryState(authKeys.userInfo.queryKey)?.error,
      'UNAUTHORIZED'
    )
  )
    return;
  const identity = queryClient.getQueryData<{
    id?: string;
    authenticated?: boolean;
  }>(authKeys.userInfo.queryKey);
  return captureQueryAccount(
    identity?.authenticated === true ? identity.id : undefined
  );
}

export function isCurrentQueryAccount(
  account: QueryAccount | undefined
): account is QueryAccount {
  const current = currentQueryAccount();
  return (
    !!account &&
    current?.userId === account.userId &&
    current.session === account.session
  );
}

export function assertQueryAccount(
  account: QueryAccount | undefined
): asserts account is QueryAccount {
  if (!isCurrentQueryAccount(account)) throw new QueryAccountChangedError();
}

/** MutationFunctionContext.meta is captured by TanStack at execute, unlike live observer options. */
export function mutationQueryAccount(
  context: MutationFunctionContext
): QueryAccount | undefined {
  const value = context.meta?.queryAccount;
  if (
    !value ||
    typeof value !== 'object' ||
    !('userId' in value) ||
    !('session' in value) ||
    typeof value.userId !== 'string' ||
    typeof value.session !== 'number'
  )
    return;
  return { userId: value.userId, session: value.session };
}

/** Keep the app shell's retained identity, but stop account-source reads until
 * a new auth request confirms the replacement session. Cached/manual writes
 * cannot reopen this gate. An old auth request is canceled before invalidation. */
export async function resetQueryAccountSession(): Promise<void> {
  stopWaitingForIdentity?.();
  resetMacroApiToken();
  const epoch = session().epoch + 1;
  setSession({ epoch, pending: true });
  const cache = queryClient.getQueryCache();
  for (const query of cache.findAll({
    predicate: (query) =>
      ACCOUNT_SOURCE_PREFIXES.some((prefix) =>
        partialMatchKey(query.queryKey, prefix)
      ),
  }))
    query.reset();
  const identity = cache.find({
    queryKey: authKeys.userInfo.queryKey,
    exact: true,
  });
  // Drain the canceled request's continuations before observing fresh success.
  // A promise already resolved just before login may still be publishing data.
  if (identity) await identity.cancel({ revert: true });
  if (session().epoch !== epoch) return;
  stopWaitingForIdentity = cache.subscribe((event) => {
    if (
      event.type !== 'updated' ||
      event.action.type !== 'success' ||
      event.action.manual ||
      event.query.queryHash !== hashKey(authKeys.userInfo.queryKey) ||
      session().epoch !== epoch
    )
      return;
    stopWaitingForIdentity?.();
    stopWaitingForIdentity = undefined;
    setSession({ epoch, pending: false });
  });
}
