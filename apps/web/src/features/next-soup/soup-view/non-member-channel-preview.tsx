import EmptyStateChannelsGraphic from '@design/empty-state-channels.svg';
import { useJoinChannelMutation } from '@queries/channel/join-links';
import { EmptyStatePanel } from '@ui';

/**
 * Preview-pane state for a focused channel the viewer is not a participant of
 * (a team channel of their team they haven't joined). The channel can't be
 * read yet, so instead of mounting the channel block the pane offers the join
 * action; once the join lands `onJoined` hands the Viewer off to the real
 * channel block (and the soup refetch flips the row's `isParticipant`).
 *
 * Takes plain display fields rather than the entity so it can render as a
 * Preview Pair Viewer component (opened from the controlling list).
 */
export function NonMemberChannelPreview(props: {
  channelId: string;
  channelName: string;
  memberCount: number;
  onJoined?: () => void;
}) {
  const joinMutation = useJoinChannelMutation({
    onSuccess: () => props.onJoined?.(),
  });

  const description = () => {
    const count = props.memberCount;
    const members =
      count > 0 ? ` (${count} ${count === 1 ? 'member' : 'members'})` : '';
    return `You're not in this channel yet${members}. Join it to read and send messages.`;
  };

  return (
    <EmptyStatePanel
      graphic={EmptyStateChannelsGraphic}
      title={props.channelName}
      description={description()}
      primaryAction={{
        label: joinMutation.isPending ? 'Joining…' : 'Join channel',
        onClick: () => {
          if (joinMutation.isPending) return;
          joinMutation.mutate({ channelId: props.channelId });
        },
      }}
      centered
    />
  );
}
