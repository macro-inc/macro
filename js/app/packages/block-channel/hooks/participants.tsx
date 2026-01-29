import { withAnalytics } from '@coparse/analytics';
import { TrackingEvents } from '@coparse/analytics/src/types/TrackingEvents';
import { toast } from '@core/component/Toast/Toast';
import { isErr } from '@core/util/maybeResult';
import { invalidateChannelWithID } from '@queries/channel/channel';
import { commsServiceClient } from '@service-comms/client';
import type { ChannelParticipant } from '@service-comms/generated/models/channelParticipant';
import type { GetChannelResponse } from '@service-comms/generated/models';
import { queryClient } from '@queries/client';
import { channelKeys } from '@queries/channel/keys';
import type { Accessor } from 'solid-js';

/**
 * Hook to add participants to a channel with optimistic updates
 */
export function useAddParticipantsToChannel(channelId: Accessor<string>) {
  const { track } = withAnalytics();

  return async (participants: string[]) => {
    const id = channelId();
    if (!id) {
      console.error(
        'tried to add participants to a channel that does not exist'
      );
      return;
    }

    // Create optimistic participants
    const newParticipants: ChannelParticipant[] = participants.map((p) => ({
      user_id: p,
      role: 'member',
      left_at: null,
      joined_at: new Date().toISOString(),
      channel_id: id,
    }));

    // Optimistically update the query cache
    const queryKey = channelKeys.withID(id).queryKey;
    const previous = queryClient.getQueryData<GetChannelResponse>(queryKey);

    queryClient.setQueryData<GetChannelResponse>(queryKey, (old) => {
      if (!old) return old;
      return {
        ...old,
        participants: [...old.participants, ...newParticipants],
      };
    });

    const res = await commsServiceClient.addParticipantsToChanenl({
      channel_id: id,
      participants: participants,
    });

    if (isErr(res)) {
      toast.failure('Failed to add participants to channel');
      console.error(res);
      // Rollback on error
      if (previous) {
        queryClient.setQueryData(queryKey, previous);
      }
      return;
    }

    // Invalidate to ensure consistency
    invalidateChannelWithID(id);

    track(TrackingEvents.BLOCKCHANNEL.PARTICIPANT.ADD);
  };
}

/**
 * Hook to remove participants from a channel with optimistic updates
 */
export function useRemoveParticipantsFromChannel(channelId: Accessor<string>) {
  return async (participants: string[]) => {
    const id = channelId();
    if (!id) {
      console.error(
        'tried to remove participants from a channel that does not exist'
      );
      return;
    }

    // Optimistically update the query cache
    const queryKey = channelKeys.withID(id).queryKey;
    const previous = queryClient.getQueryData<GetChannelResponse>(queryKey);

    queryClient.setQueryData<GetChannelResponse>(queryKey, (old) => {
      if (!old) return old;
      return {
        ...old,
        participants: old.participants.filter(
          (p) => !participants.includes(p.user_id)
        ),
      };
    });

    const res = await commsServiceClient.removeParticipantsFromChannel({
      channel_id: id,
      participants: participants,
    });

    if (isErr(res)) {
      toast.failure('Failed to remove participants from channel');
      console.error(res);
      // Rollback on error
      if (previous) {
        queryClient.setQueryData(queryKey, previous);
      }
      return;
    }

    // Invalidate to ensure consistency
    invalidateChannelWithID(id);
  };
}
