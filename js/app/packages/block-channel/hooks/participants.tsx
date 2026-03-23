import { useAnalytics } from '@app/component/analytics-context';
import {
  useAddParticipantsMutation,
  useRemoveParticipantsMutation,
} from '@queries/channel/participants';
import type { Accessor } from 'solid-js';

/**
 * Hook to add participants to a channel with optimistic updates
 */
export function useAddParticipantsToChannel(channelId: Accessor<string>) {
  const analytics = useAnalytics();

  const mutation = useAddParticipantsMutation({
    onSuccess: () => {
      analytics.track('channel_participant_add');
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
  const analytics = useAnalytics();

  const mutation = useRemoveParticipantsMutation({
    onSuccess: () => {
      analytics.track('channel_participant_remove');
    },
  });

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
