import { useUserId } from '@core/context/user';
import {
  useAddReactionMutation,
  useRemoveReactionMutation,
} from '@queries/channel/reaction';
import type { Accessor } from 'solid-js';
import type { GetChannelResponseReactions } from '@service-comms/generated/models';
import { useAnalytics } from '@app/component/analytics-context';

type CountedReaction = {
  emoji: string;
  users: string[];
};

/**
 * Hook to react to a message. Uses the reaction mutations with optimistic updates.
 */
export function useReactToMessage(
  channelId: Accessor<string>,
  reactions: Accessor<GetChannelResponseReactions>
) {
  const analytics = useAnalytics();
  const userId_ = useUserId();

  const addReaction = useAddReactionMutation();
  const removeReaction = useRemoveReactionMutation();

  return async (emoji: string, messageId: string) => {
    const userId = userId_();
    const channelIdValue = channelId();
    if (!channelIdValue || !userId) return;

    const messageReactions = reactions()?.[messageId] ?? [];
    const hasReacted = messageReactions.some(
      (reaction: CountedReaction) =>
        reaction.emoji === emoji && reaction.users.includes(userId)
    );

    if (hasReacted) {
      await removeReaction.mutateAsync({
        channelId: channelIdValue,
        messageId,
        emoji,
        userId,
      });
    } else {
      await addReaction.mutateAsync({
        channelId: channelIdValue,
        messageId,
        emoji,
        userId,
      });
    }

    analytics.track('channel_reaction', {
      emoji,
      action: hasReacted ? 'remove' : 'add',
    });
  };
}
