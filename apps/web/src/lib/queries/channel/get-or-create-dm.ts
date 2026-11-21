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
import { useMutation } from '@tanstack/solid-query';
import { okAsync, ResultAsync } from 'neverthrow';
import { assertQueryAccount, currentQueryAccount } from '../auth/account-scope';
import { refreshChannelDirectory } from './directory';

type GetOrCreateDmResponse = GetOrCreateChannelResponse;

type GetOrCreateDirectMessageParams = {
  parentSpan?: TraceContext;
  recipient_id: string;
};

/**
 * Create or resolve a 1:1 DM channel for a recipient. Refreshes the in-memory
 * channel directory on settle.
 */
export function useGetOrCreateDirectMessageMutation(
  callbacks?: MutationCallbacks<
    GetOrCreateDmResponse,
    Error,
    GetOrCreateDirectMessageParams,
    undefined
  >
) {
  return useMutation(() => ({
    gcTime: 0,
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
        onSettled: (data) =>
          fireAndForget(
            refreshChannelDirectory(data ? [data.channel_id] : []),
            'channel-list'
          ),
      },
      callbacks,
      (variables) => variables.parentSpan
    ),
  }));
}

/**
 * The DM with `recipientId`, created if there is none yet. For a recipient
 * that writes first (an agent teammate's greeting), so the conversation shown
 * is the real one its message lands in. Refreshes the channel directory after.
 */
export function getOrCreateDirectMessageChannel(
  recipientId: string
): ResultAsync<string, ResultError[]> {
  return new ResultAsync(
    storageServiceClient.getOrCreateDirectMessage({ recipient_id: recipientId })
  ).map(({ channel_id }) => {
    fireAndForget(refreshChannelDirectory([channel_id]), 'channel-list');
    return channel_id;
  });
}

/**
 * The viewer's existing DM with a person, without creating one: the one the
 * server's get-or-create would reuse. Asked of the server each time, since
 * the DM may be one the viewer's directory has not loaded yet. The server
 * looks up people only; agents are opened through their own DM flow
 * (`openTeamAgentDirectMessage`), so a bot answers none without asking.
 */
export function existingDirectMessage(
  viewerId: string,
  recipientId: string
): ResultAsync<string | undefined, unknown> {
  if (recipientId === viewerId || isBotPrincipalId(recipientId))
    return okAsync(undefined);
  return ResultAsync.fromPromise(
    lookupDirectMessage(recipientId),
    (error) => error
  );
}

async function lookupDirectMessage(
  recipientId: string
): Promise<string | undefined> {
  const account = currentQueryAccount();
  assertQueryAccount(account);
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

type GetOrCreatePrivateChannelParams = {
  parentSpan?: TraceContext;
  recipients: string[];
};

/**
 * Create or resolve a private group channel for a set of recipients.
 * Refreshes the in-memory channel directory on settle.
 */
export function useGetOrCreatePrivateChannelMutation(
  callbacks?: MutationCallbacks<
    GetOrCreateChannelResponse,
    Error,
    GetOrCreatePrivateChannelParams,
    undefined
  >
) {
  return useMutation(() => ({
    gcTime: 0,
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
        onSettled: (data) =>
          fireAndForget(
            refreshChannelDirectory(data ? [data.channel_id] : []),
            'channel-list'
          ),
      },
      callbacks,
      (variables) => variables.parentSpan
    ),
  }));
}
