import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { storageServiceClient } from '@service-storage/client';
import { queryOptions } from '@tanstack/solid-query';
import { channelKeys } from './keys';
import type { ChannelParticipant } from './types';

/** Why a reader asks REST: its by-id read left the channel out, or failed. */
export type ParticipantsFallbackReason =
  | 'channel not in soup'
  | 'channel read failed';

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
