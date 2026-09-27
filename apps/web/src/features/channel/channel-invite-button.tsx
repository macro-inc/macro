import { useUserId } from '@core/context/user';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import UserPlusIcon from '@phosphor/user-plus.svg';
import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';
import { useAddParticipantsMutation } from '@queries/channel/participants';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { Button } from '@ui';
import { createSignal, Show, Suspense } from 'solid-js';
import { ChannelInviteModal } from './views/channel-invite-modal';

export function ChannelInviteButton(props: {
  channelId: string;
  channelName: string;
  channelType?: string;
}) {
  const userId = useUserId();
  const participantsQuery = useChannelParticipantsQuery(() => props.channelId);
  const [open, setOpen] = createSignal(false);
  const participants = () =>
    participantsQuery.isSuccess ? (participantsQuery.data ?? []) : [];
  const canInvite = () =>
    (props.channelType === 'team' || props.channelType === 'private') &&
    participants().some((participant) => participant.user_id === userId());

  return (
    <Show when={canInvite()}>
      <Button
        variant="outline"
        size="sm"
        label="Invite people"
        tooltip="Invite people"
        onClick={() => setOpen(true)}
      >
        <UserPlusIcon />
        <span class="hidden sm:inline">Invite</span>
      </Button>
      <Suspense>
        <Show when={open()}>
          <ChannelInviteDialog
            channelId={props.channelId}
            channelName={props.channelName}
            participantIds={participants().map(
              (participant) => participant.user_id
            )}
            participantsReady={participantsQuery.isSuccess}
            onClose={() => setOpen(false)}
          />
        </Show>
      </Suspense>
    </Show>
  );
}

function ChannelInviteDialog(props: {
  channelId: string;
  channelName: string;
  participantIds: string[];
  participantsReady: boolean;
  onClose: () => void;
}) {
  const teamQuery = useCurrentTeamQuery();
  const { users } = useCombinedRecipients();
  const addParticipants = useAddParticipantsMutation();
  const team = () => {
    const data = teamQuery.isSuccess ? teamQuery.data : undefined;
    return data
      ? {
          name: data.team.name,
          memberIds: data.members.map((member) => member.user_id),
        }
      : undefined;
  };

  return (
    <ChannelInviteModal
      {...props}
      team={team()}
      teamLoading={teamQuery.isPending}
      teamError={teamQuery.isError}
      options={users}
      onAdd={(participants) =>
        addParticipants.mutateAsync({
          channelId: props.channelId,
          participants,
        })
      }
    />
  );
}
