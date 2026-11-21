import { isBotPrincipalId } from '@core/constant/macroAgent';
import { fireAndForget } from '@core/util/fireAndForget';
import { type ResultError, throwOnErr } from '@core/util/result';
import { Telemetry, type TraceContext } from '@macro-inc/observability';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  type GetOrCreateChannelResponse,
  storageServiceClient,
} from '@service-storage/client';
import { DirectMessageChannelIdDocument } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import {
  type MutationFunctionContext,
  useMutation,
} from '@tanstack/solid-query';
import { okAsync, ResultAsync } from 'neverthrow';
import {
  assertQueryAccount,
  currentQueryAccount,
  isCurrentQueryAccount,
  mutationQueryAccount,
  type QueryAccount,
  QueryAccountChangedError,
} from '../auth/account-scope';
import { useQueryAccount } from '../auth/use-query-account';
import { refreshChannelDirectory } from './directory';

type GetOrCreateDmResponse = GetOrCreateChannelResponse;

type GetOrCreateDirectMessageParams = {
  parentSpan?: TraceContext;
  recipient_id: string;
};

type GetOrCreatePrivateChannelParams = {
  parentSpan?: TraceContext;
  recipients: string[];
};

/**
 * Reads the conversation found or created into the channel directory, unless
 * the sign-in that asked was replaced since: the directory it would refresh
 * is gone, and a read now would run as the replacement.
 */
function refreshAfterConversation(
  account: QueryAccount | undefined,
  channelId: string | undefined
) {
  if (!isCurrentQueryAccount(account)) return;
  fireAndForget(
    refreshChannelDirectory(channelId ? [channelId] : []),
    'channel-list'
  );
}

function refreshAfterSettled(
  data: GetOrCreateChannelResponse | undefined,
  context: MutationFunctionContext
) {
  refreshAfterConversation(mutationQueryAccount(context), data?.channel_id);
}

/** Creates or resolves a 1:1 DM with a recipient, as `account`. */
function getOrCreateDirectMessageMutationOptions(
  callbacks?: MutationCallbacks<
    GetOrCreateDmResponse,
    Error,
    GetOrCreateDirectMessageParams,
    undefined
  >,
  account = currentQueryAccount()
) {
  return {
    gcTime: 0,
    meta: { queryAccount: account },
    mutationFn: async (vars: GetOrCreateDirectMessageParams) => {
      return await throwOnErr(async () =>
        (vars.parentSpan ?? Telemetry.captureContext()).run(() =>
          storageServiceClient.getOrCreateDirectMessage({
            recipient_id: vars.recipient_id,
          })
        )
      );
    },
    ...withCallbacks<
      GetOrCreateDmResponse,
      Error,
      GetOrCreateDirectMessageParams,
      undefined
    >(
      {
        onError(error) {
          console.error('failed to get or create direct message', error);
        },
        onSettled: (data, _error, _vars, _result, context) =>
          refreshAfterSettled(data, context),
      },
      callbacks,
      (variables) => variables.parentSpan
    ),
  };
}

/**
 * Create or resolve a 1:1 DM channel for a recipient. Refreshes the in-memory
 * channel directory on settle, in the sign-in that started it.
 */
export function useGetOrCreateDirectMessageMutation(
  callbacks?: MutationCallbacks<
    GetOrCreateDmResponse,
    Error,
    GetOrCreateDirectMessageParams,
    undefined
  >
) {
  const account = useQueryAccount();
  return useMutation(() =>
    getOrCreateDirectMessageMutationOptions(callbacks, account())
  );
}

/**
 * The DM with `recipientId`, created if there is none yet. For a recipient
 * that writes first (an agent teammate's greeting), so the conversation shown
 * is the real one its message lands in. Refreshes the channel directory after,
 * in the sign-in that asked.
 */
export function getOrCreateDirectMessageChannel(
  recipientId: string
): ResultAsync<string, ResultError[]> {
  const account = currentQueryAccount();
  return new ResultAsync(
    storageServiceClient.getOrCreateDirectMessage({ recipient_id: recipientId })
  ).map(({ channel_id }) => {
    refreshAfterConversation(account, channel_id);
    return channel_id;
  });
}

/**
 * The viewer's existing DM with a person, without creating one: among the
 * DMs the viewer is still in, the one the server's get-or-create would reuse,
 * as the joined channel list it replaces showed it. A DM the viewer left is
 * not answered, though get-or-create may still reuse it. Asked of the server
 * each time, since the DM may be one the viewer's directory has not loaded
 * yet. The server looks up people only; agents are opened through their own
 * DM flow (`openTeamAgentDirectMessage`), so a bot answers none without
 * asking.
 */
export function existingDirectMessage(
  viewerId: string,
  recipientId: string
): ResultAsync<string | undefined, unknown> {
  if (recipientId === viewerId || isBotPrincipalId(recipientId))
    return okAsync(undefined);
  return ResultAsync.fromPromise(
    lookupDirectMessage(viewerId, recipientId),
    (error) => error
  );
}

// Looked up as `viewerId` only: a lookup for a viewer who is no longer
// signed in rejects with `QueryAccountChangedError`.
async function lookupDirectMessage(
  viewerId: string,
  recipientId: string
): Promise<string | undefined> {
  const account = currentQueryAccount();
  assertQueryAccount(account);
  if (account.userId !== viewerId) throw new QueryAccountChangedError();
  const result = await getGraphqlSoupClient()
    .query(
      DirectMessageChannelIdDocument,
      { userId: recipientId },
      { requestPolicy: 'network-only' }
    )
    .toPromise();
  assertQueryAccount(account);
  if (result.error) throw result.error;
  return result.data?.user.directMessageChannelId ?? undefined;
}

/** Creates or resolves a private group channel, as `account`. */
function getOrCreatePrivateChannelMutationOptions(
  callbacks?: MutationCallbacks<
    GetOrCreateChannelResponse,
    Error,
    GetOrCreatePrivateChannelParams,
    undefined
  >,
  account = currentQueryAccount()
) {
  return {
    gcTime: 0,
    meta: { queryAccount: account },
    mutationFn: async (vars: GetOrCreatePrivateChannelParams) => {
      return await throwOnErr(async () =>
        (vars.parentSpan ?? Telemetry.captureContext()).run(() =>
          storageServiceClient.getOrCreatePrivateChannel({
            recipients: vars.recipients,
          })
        )
      );
    },
    ...withCallbacks<
      GetOrCreateChannelResponse,
      Error,
      GetOrCreatePrivateChannelParams,
      undefined
    >(
      {
        onError(error) {
          console.error('failed to get or create private channel', error);
        },
        onSettled: (data, _error, _vars, _result, context) =>
          refreshAfterSettled(data, context),
      },
      callbacks,
      (variables) => variables.parentSpan
    ),
  };
}

/**
 * Create or resolve a private group channel for a set of recipients.
 * Refreshes the in-memory channel directory on settle, in the sign-in that
 * started it.
 */
export function useGetOrCreatePrivateChannelMutation(
  callbacks?: MutationCallbacks<
    GetOrCreateChannelResponse,
    Error,
    GetOrCreatePrivateChannelParams,
    undefined
  >
) {
  const account = useQueryAccount();
  return useMutation(() =>
    getOrCreatePrivateChannelMutationOptions(callbacks, account())
  );
}
