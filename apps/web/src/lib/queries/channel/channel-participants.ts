import { ThrownResultError, throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import {
  type ApiChannelParticipant,
  storageServiceClient,
} from '@service-storage/client';
import type { ApiParticipantRole } from '@service-storage/generated/schemas/apiParticipantRole';
import {
  ChannelParticipantsSoupDocument,
  type ChannelParticipantsSoupQuery,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupNetworkClient } from '@service-storage/graphql-soup';
import { useQuery } from '@tanstack/solid-query';
import type {
  CombinedError,
  OperationResult,
  OperationResultSource,
} from '@urql/core';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import { queryClient } from '../client';
import { channelKeys } from './keys';

type GraphqlParticipant = Extract<
  ChannelParticipantsSoupQuery['user']['soupEntity'],
  { participants: unknown }
>['participants'][number];

export function channelParticipantsQueryOptions(channelId: string) {
  return {
    queryKey: channelKeys.participants(channelId).queryKey,
    queryFn: async ({
      signal,
    }: {
      signal: AbortSignal;
    }): Promise<ApiChannelParticipant[]> => {
      const parent = Telemetry.captureContext();
      return (
        (await readParticipantsFromGraphql(channelId, signal)) ??
        (await parent.run(() => readParticipantsFromRest(channelId)))
      );
    },
    staleTime: Infinity,
  };
}

export function useChannelParticipantsQuery(channelId: Accessor<string>) {
  return useQuery(() => ({
    ...channelParticipantsQueryOptions(channelId()),
    enabled: !!channelId(),
  }));
}

export function invalidateChannelParticipants(channelId: string) {
  return queryClient.invalidateQueries({
    queryKey: channelKeys.participants(channelId).queryKey,
  });
}

export function softInvalidateChannelParticipants(channelId: string) {
  return queryClient.invalidateQueries({
    queryKey: channelKeys.participants(channelId).queryKey,
    refetchType: 'inactive',
  });
}

/**
 * The channel's participants as `GET /channels/:id/participants` lists them,
 * read by id from the GraphQL soup's primary, past the normalized cache.
 * Undefined when the soup does not return the channel: it leaves out public
 * channels the viewer has not joined.
 */
async function readParticipantsFromGraphql(
  channelId: string,
  signal: AbortSignal
): Promise<ApiChannelParticipant[] | undefined> {
  const result = await firstSettledResult(
    getGraphqlSoupNetworkClient().query(
      ChannelParticipantsSoupDocument,
      { input: { entityType: 'CHANNEL', entityId: channelId } },
      { requestPolicy: 'network-only' }
    ),
    signal
  );
  if (result.error) throw toQueryError(result.error);
  const channel = result.data?.user.soupEntity;
  if (!channel || !('participants' in channel)) return undefined;
  return toRestParticipants(channel.participants);
}

/**
 * The read's first settled result, like `toPromise()`, but torn down as soon
 * as the query cancels it. urql answers a request still in flight to every
 * later identical request, so a read cancelled by a write's invalidation would
 * otherwise hand its pre-write roster to the read that replaces it.
 */
function firstSettledResult<T extends OperationResult>(
  source: OperationResultSource<T>,
  signal: AbortSignal
): Promise<T> {
  return new Promise((resolve, reject) => {
    let subscription: ReturnType<typeof source.subscribe> | undefined;
    let settled = false;
    const finish = () => {
      settled = true;
      signal.removeEventListener('abort', onAbort);
      subscription?.unsubscribe();
    };
    function onAbort() {
      finish();
      reject(signal.reason);
    }
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    subscription = source.subscribe((result) => {
      if (settled || result.stale || result.hasNext) return;
      finish();
      resolve(result);
    });
    if (settled) subscription.unsubscribe();
  });
}

/** Active participants, earliest joined first, in the REST read's shape. */
function toRestParticipants(
  participants: readonly GraphqlParticipant[]
): ApiChannelParticipant[] {
  return participants
    .filter((participant) => participant.leftAt === null)
    .map((participant) => ({
      channel_id: participant.channelId,
      user_id: participant.userId,
      role: toRole(participant.role),
      // RFC 3339 with an offset; REST writes the same instant with `Z`.
      joined_at: participant.joinedAt.replace(/\+00:00$/, 'Z'),
    }))
    .sort((a, b) => compareInstants(a.joined_at, b.joined_at));
}

/**
 * Orders two UTC RFC 3339 instants to the microsecond, as the database
 * orders them; `Date.parse` keeps only milliseconds.
 */
function compareInstants(a: string, b: string): number {
  const [aSeconds, aFraction] = splitInstant(a);
  const [bSeconds, bFraction] = splitInstant(b);
  return (
    Date.parse(aSeconds) - Date.parse(bSeconds) ||
    aFraction.localeCompare(bFraction)
  );
}

/** The instant in whole seconds, and its fraction padded to nanoseconds. */
function splitInstant(instant: string): [string, string] {
  const parts = /^([^.]*?)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)$/.exec(instant);
  if (!parts) return [instant, ''];
  const [, seconds, fraction = '', zone] = parts;
  return [`${seconds}${zone}`, fraction.padEnd(9, '0')];
}

function toRole(role: string): ApiParticipantRole {
  return match(role)
    .with('owner', 'admin', 'member', (known) => known)
    .otherwise(() => 'member');
}

/** Auth failures carry the codes the query client's retry policy reads, as
 * the REST read's errors did; anything else rejects with the GraphQL error.
 * The `user` field refuses a request without a signed-in user in a 200
 * response, which REST answered with a 401. */
function toQueryError(error: CombinedError): Error {
  const status = error.response?.status;
  const unauthenticated = error.graphQLErrors.some(
    (graphqlError) => graphqlError.message === 'authentication required'
  );
  if (status === 401 || unauthenticated)
    return new ThrownResultError([
      { code: 'UNAUTHORIZED', message: error.message },
    ]);
  if (status === 403)
    return new ThrownResultError([
      { code: 'FORBIDDEN', message: error.message },
    ]);
  return error;
}

/**
 * The REST read, for a channel the soup read does not return. Remove it once
 * the soup channel read returns public channels by id.
 */
async function readParticipantsFromRest(
  channelId: string
): Promise<ApiChannelParticipant[]> {
  return await Telemetry.span(
    'soup.rest_fallback',
    {
      kind: 'client',
      attributes: {
        'soup.fallback.shape': 'channel participants',
        'soup.fallback.kind': 'channel_participants',
        'soup.fallback.reason': 'channel not in soup',
        'channel.id': channelId,
      },
    },
    async (span) => {
      try {
        return await throwOnErr(() =>
          storageServiceClient.getChannelParticipants({
            channel_id: channelId,
          })
        );
      } catch (error) {
        span.error(error);
        throw error;
      }
    }
  );
}
