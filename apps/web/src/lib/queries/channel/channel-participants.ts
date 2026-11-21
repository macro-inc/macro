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
import type { CombinedError } from '@urql/core';
import type { Accessor } from 'solid-js';
import { match } from 'ts-pattern';
import { queryClient } from '../client';
import { buildGraphqlEntitySoupInput } from '../soup/graphql/entity-input';
import { channelKeys } from './keys';

type GraphqlParticipant = Extract<
  ChannelParticipantsSoupQuery['user']['soup']['items'][number],
  { participants: unknown }
>['participants'][number];

export function channelParticipantsQueryOptions(channelId: string) {
  return {
    queryKey: channelKeys.participants(channelId).queryKey,
    queryFn: async (): Promise<ApiChannelParticipant[]> =>
      (await readParticipantsFromGraphql(channelId)) ??
      (await readParticipantsFromRest(channelId)),
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
 * read by id from the GraphQL soup, past the normalized cache. Undefined when
 * the soup does not return the channel: it leaves out public channels the
 * viewer has not joined.
 */
async function readParticipantsFromGraphql(
  channelId: string
): Promise<ApiChannelParticipant[] | undefined> {
  const input = buildGraphqlEntitySoupInput('CHANNEL', channelId);
  if (!input) return undefined;
  const result = await getGraphqlSoupNetworkClient()
    .query(
      ChannelParticipantsSoupDocument,
      { input },
      { requestPolicy: 'network-only' }
    )
    .toPromise();
  if (result.error) throw toQueryError(result.error);
  const channel = result.data?.user.soup.items.find(
    (item) =>
      'participants' in item &&
      item.id.toLowerCase() === channelId.toLowerCase()
  );
  if (!channel || !('participants' in channel)) return undefined;
  return toRestParticipants(channel.participants);
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
    .sort((a, b) => Date.parse(a.joined_at) - Date.parse(b.joined_at));
}

function toRole(role: string): ApiParticipantRole {
  return match(role)
    .with('owner', 'admin', 'member', (known) => known)
    .otherwise(() => 'member');
}

/** Auth failures carry the codes the query client's retry policy reads, as
 * the REST read's errors did; anything else rejects with the GraphQL error. */
function toQueryError(error: CombinedError): Error {
  const status = error.response?.status;
  if (status === 401)
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
