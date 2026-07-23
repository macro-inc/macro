import EmptyStateChannelsGraphic from '@design/empty-state-channels.svg';
import type { ChannelEntity } from '@entity';
import { useJoinChannelMutation } from '@queries/channel/join-links';
import { EmptyStatePanel } from '@ui';

/**
 * Preview-pane state for a focused channel the viewer is not a participant of
 * (a team channel of their team they haven't joined). The channel can't be
 * read yet, so instead of mounting the channel block the pane offers the join
 * action; once the join lands the soup refetch flips `isParticipant` and the
 * real preview takes over.
 */
export function NonMemberChannelPreview(props: { entity: ChannelEntity }) {
  const joinMutation = useJoinChannelMutation();

  const description = () => {
    const count = props.entity.participantIds?.length ?? 0;
    const members =
      count > 0 ? ` (${count} ${count === 1 ? 'member' : 'members'})` : '';
    return `You're not in this channel yet${members}. Join it to read and send messages.`;
  };

  return (
    <EmptyStatePanel
      graphic={EmptyStateChannelsGraphic}
      title={props.entity.name}
      description={description()}
      primaryAction={{
        label: joinMutation.isPending ? 'Joining…' : 'Join channel',
        onClick: () => {
          if (joinMutation.isPending) return;
          joinMutation.mutate({ channelId: props.entity.id });
        },
      }}
      centered
    />
  );
}
