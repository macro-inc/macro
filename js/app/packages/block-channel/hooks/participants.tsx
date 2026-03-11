import { withAnalytics } from '@coparse/analytics';
import { TrackingEvents } from '@coparse/analytics/src/types/TrackingEvents';
import {
  useAddParticipantsMutation,
  useRemoveParticipantsMutation,
} from '@queries/channel/participants';
import type { Accessor } from 'solid-js';

/**
 * Hook to add participants to a channel with optimistic updates
 */
export function useAddParticipantsToChannel(channelId: Accessor<string>) {
  const { track } = withAnalytics();
  const mutation = useAddParticipantsMutation({
    onSuccess: () => {
      track(TrackingEvents.BLOCKCHANNEL.PARTICIPANT.ADD);
    },
  });

  return (participants: string[]) => {
    const id = channelId();
    if (!id) {
      console.error(
        'tried to add participants to a channel that does not exist'
      );
      return;
    }

    mutation.mutate({ channelId: id, participants });
  };
}

/**
 * Hook to remove participants from a channel with optimistic updates
 */
export function useRemoveParticipantsFromChannel(channelId: Accessor<string>) {
  const mutation = useRemoveParticipantsMutation();

  return (participants: string[]) => {
    const id = channelId();
    if (!id) {
      console.error(
        'tried to remove participants from a channel that does not exist'
      );
      return;
    }

    mutation.mutate({ channelId: id, participants });
  };
}
