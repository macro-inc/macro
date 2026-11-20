import { throwOnErr } from '@core/util/result';
import { sleep } from '@core/util/sleep';
import { Telemetry } from '@macro-inc/observability';
import { storageServiceClient } from '@service-storage/client';
import { queryOptions } from '@tanstack/solid-query';
import { channelKeys } from './keys';
import type { ChannelParticipant } from './types';

/**
 * Why a reader asks REST: its by-id read left the channel out, failed, or has
 * not answered for a while.
 */
export type ParticipantsFallbackReason =
  | 'channel not in soup'
  | 'channel read failed'
  | 'channel read slow';

/**
 * Counted as the Soup list reads that fall back to REST count theirs: a
 * `soup.rest_fallback` span, by reason and shape.
 */
const FALLBACK_ATTRIBUTES = {
  'soup.fallback.shape': 'channel participants',
  'soup.fallback.kind': 'channel_participants',
};

/**
 * The participants of a channel the GraphQL soup read does not return.
 *
 * That read returns only channels the viewer joined and team channels of
 * their teams, while REST lets anyone read a public channel's participants.
 * Readers use this only when the channel's by-id GraphQL read came back
 * without the channel, or failed before it ever answered. Remove it once the
 * soup channel read returns public channels by id.
 */
export function channelParticipantsRestFallbackOptions(
  channelId: string,
  enabled: boolean,
  reason: ParticipantsFallbackReason = 'channel not in soup'
) {
  return queryOptions({
    ...channelKeys.participantsFallback(channelId),
    enabled,
    // A failed or slow channel read asks REST after the soup record may have
    // moved on without it; rows cached before then are no answer.
    // (Spread: an undefined staleTime would override the client's default.)
    ...(reason === 'channel not in soup' ? {} : { staleTime: 0 }),
    queryFn: () => readParticipantsFromRest(channelId, reason),
  });
}

async function readParticipantsFromRest(
  channelId: string,
  reason: ParticipantsFallbackReason
): Promise<ChannelParticipant[]> {
  return await Telemetry.span(
    'soup.rest_fallback',
    {
      kind: 'client',
      attributes: { ...FALLBACK_ATTRIBUTES, 'soup.fallback.reason': reason },
    },
    async (span) => {
      try {
        const participants = await throwOnErr(() =>
          storageServiceClient.getChannelParticipants({
            channel_id: channelId,
          })
        );
        // Earliest joined first, as the soup record lists them.
        return participants
          .map((participant) => ({ ...participant, left_at: null }))
          .sort((a, b) => Date.parse(a.joined_at) - Date.parse(b.joined_at));
      } catch (error) {
        span.error(error);
        throw error;
      }
    }
  );
}

/** How long the server gets to say who is in a channel before a reader stops waiting. */
const SERVER_CHECK_TIMEOUT_MS = 10_000;

/**
 * Who the server says is in a channel now, read past every cache: a reader
 * asks before it stops showing a succeeded add or remove whose soup update has
 * not arrived. Undefined when the read fails or takes too long.
 */
export async function readParticipantsOnServer(
  channelId: string
): Promise<string[] | undefined> {
  return await Telemetry.span(
    'channel.participants.server_check',
    { kind: 'client', attributes: { 'channel.id': channelId } },
    async (span) => {
      const result = await Promise.race([
        storageServiceClient.getChannelParticipants({ channel_id: channelId }),
        timedOut(SERVER_CHECK_TIMEOUT_MS),
      ]);
      if (result === 'timeout') {
        span.setAttr('channel.participants.check_outcome', 'timeout');
        return undefined;
      }
      if (result.isErr()) {
        span.setAttr('channel.participants.check_outcome', 'failed');
        return undefined;
      }
      span.setAttr('channel.participants.check_outcome', 'answered');
      return result.value.map((participant) => participant.user_id);
    }
  );
}

async function timedOut(ms: number) {
  await sleep(ms);
  return 'timeout' as const;
}
