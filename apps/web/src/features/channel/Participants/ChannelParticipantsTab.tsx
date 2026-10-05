import { useSplitLayout } from '@components/app/split-layout/layout';
import { useChannel, useChannelType } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { getDisplayName, idToEmail, tryMacroId } from '@core/user';

import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';
import { usePatchChannelMutation } from '@queries/channel/channels';
import { useGetOrCreateDirectMessageMutation } from '@queries/channel/get-or-create-dm';
import {
  useAddParticipantsMutation,
  useRemoveParticipantsMutation,
} from '@queries/channel/participants';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { ChannelType } from '@service-storage/generated/schemas/channelType';
import { ParticipantRole } from '@service-storage/generated/schemas/participantRole';
import { Card, Scroll } from '@ui';
import { createSignal, Show } from 'solid-js';
import { ChannelBotsPanel } from './ChannelBotsPanel';
import { ChannelJoinLinkButton } from './ChannelJoinLinkButton';
import { ChannelTeamSettingsPanel } from './ChannelTeamSettingsPanel';
import { ParticipantsAddPanel } from './ParticipantsAddPanel';
import { ParticipantsList } from './ParticipantsList';
import { ParticipantsSearchInput } from './ParticipantsSearchInput';

export function ChannelParticipantsTab(props: {
  channelId: string;
  botManagementEnabled: boolean;
  inviteBotFocusRequest: number;
  onCreateBot: () => void;
  onOpenBot: (botId: string) => void;
}) {
  const { openWithSplit } = useSplitLayout();
  const userId = useUserId();
  const channel = useChannel(props.channelId);
  const channelType = useChannelType(props.channelId);
  const participantsQuery = useChannelParticipantsQuery(() => props.channelId);
  const currentTeamQuery = useCurrentTeamQuery();
  const patchChannelMutation = usePatchChannelMutation();
  const addParticipantsMutation = useAddParticipantsMutation();
  const removeParticipantsMutation = useRemoveParticipantsMutation();
  const getOrCreateDmMutation = useGetOrCreateDirectMessageMutation();
  const [searchQuery, setSearchQuery] = createSignal('');

  const participants = () => participantsQuery.data ?? [];
  const currentParticipant = () =>
    participants().find((participant) => participant.user_id === userId());
  const canManageChannel = () => {
    const role = currentParticipant()?.role;
    return role === ParticipantRole.owner || role === ParticipantRole.admin;
  };
  const pendingPatch = () =>
    patchChannelMutation.isPending ? patchChannelMutation.variables : undefined;
  const isTeamChannel = () =>
    channelType() === ChannelType.team ||
    pendingPatch()?.convert_to_team_channel === true;
  const autoJoinTeam = () => {
    const pendingAutoJoin = pendingPatch()?.auto_join_team;
    return typeof pendingAutoJoin === 'boolean'
      ? pendingAutoJoin
      : (channel()?.auto_join_team ?? false);
  };
  const supportsTeamSettings = () =>
    channelType() === ChannelType.private ||
    channelType() === ChannelType.public ||
    channelType() === ChannelType.team;
  const currentTeam = () => currentTeamQuery.data?.team;
  const canConvertToTeam = () => !isTeamChannel() && !!currentTeam();
  const conversionUnavailableReason = () => {
    if (isTeamChannel() || currentTeam()) return undefined;
    return currentTeamQuery.isLoading
      ? 'Checking your team membership…'
      : 'You need to belong to a team before converting this channel.';
  };
  const canAddParticipants = () =>
    channelType() === ChannelType.private || channelType() === ChannelType.team;
  const isEditable = () => canAddParticipants();

  const filteredParticipants = () => {
    const query = searchQuery().trim().toLowerCase();
    if (query.length === 0) return participants();

    return participants().filter((participant) => {
      const email = idToEmail(participant.user_id).toLowerCase();
      return (
        participant.user_id.toLowerCase().includes(query) ||
        getDisplayName(tryMacroId(participant.user_id))
          .toLowerCase()
          .includes(query) ||
        email.includes(query) ||
        participant.role.toLowerCase().includes(query)
      );
    });
  };

  const addParticipants = (participantIds: string[]) => {
    if (!isEditable() || participantIds.length === 0) return;

    addParticipantsMutation.mutate({
      channelId: props.channelId,
      participants: participantIds,
    });
  };

  const removeParticipant = (participantId: string) => {
    if (!isEditable()) return;

    const participant = participants().find((p) => p.user_id === participantId);
    if (participant?.role === 'owner') return;

    removeParticipantsMutation.mutate({
      channelId: props.channelId,
      participants: [participantId],
    });
  };

  const convertToTeamChannel = () => {
    if (!canManageChannel() || !canConvertToTeam()) return;
    patchChannelMutation.mutate({
      channelId: props.channelId,
      channel_name: channel()?.name,
      convert_to_team_channel: true,
    });
  };

  const updateAutoJoinTeam = (enabled: boolean) => {
    if (!canManageChannel() || channelType() !== ChannelType.team) return;
    patchChannelMutation.mutate({
      channelId: props.channelId,
      auto_join_team: enabled,
    });
  };

  const openDirectMessage = (participantId: string, event: MouseEvent) => {
    getOrCreateDmMutation.mutate(
      { recipient_id: participantId },
      {
        onSuccess: ({ channel_id }) => {
          openWithSplit(
            { type: 'channel', id: channel_id },
            { activate: true, preferNewSplit: event.shiftKey }
          );
        },
      }
    );
  };

  return (
    <div class="min-h-0 flex-1 overflow-hidden">
      <div class="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 p-4 touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+1rem)]">
        <Card class="min-h-0 flex-1">
          <Card.Header class="shrink-0">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <Card.Title>Participants</Card.Title>
              <Show when={channelType() === ChannelType.private}>
                <ChannelJoinLinkButton channelId={props.channelId} />
              </Show>
            </div>
          </Card.Header>
          <Card.Body class="flex min-h-0 flex-1 flex-col gap-3">
            <div class="flex shrink-0 flex-col gap-3">
              <ParticipantsSearchInput
                value={searchQuery()}
                onInput={setSearchQuery}
              />
              <Show when={isEditable()}>
                <div class="-mx-3 border-y border-edge-muted px-3 py-4">
                  <ParticipantsAddPanel
                    participants={participants}
                    onAddParticipants={addParticipants}
                  />
                </div>
              </Show>
            </div>
            <div class="min-h-0 flex-1">
              <Scroll aria-label="Participants list">
                <ParticipantsList
                  participants={filteredParticipants}
                  searchQuery={searchQuery}
                  currentUserId={userId() ?? undefined}
                  editable={isEditable()}
                  onParticipantClick={openDirectMessage}
                  onRemoveParticipant={removeParticipant}
                />
              </Scroll>
            </div>
          </Card.Body>
        </Card>
        <Show when={canManageChannel() && supportsTeamSettings()}>
          <ChannelTeamSettingsPanel
            isTeamChannel={isTeamChannel()}
            autoJoinTeam={autoJoinTeam()}
            canConvertToTeam={canConvertToTeam()}
            conversionUnavailableReason={conversionUnavailableReason()}
            disabled={patchChannelMutation.isPending}
            onConvertToTeam={convertToTeamChannel}
            onAutoJoinTeamChange={updateAutoJoinTeam}
          />
        </Show>
        <Show when={props.botManagementEnabled}>
          <ChannelBotsPanel
            channelId={props.channelId}
            editable={isEditable()}
            inviteFocusRequest={props.inviteBotFocusRequest}
            onCreateBot={props.onCreateBot}
            onOpenBot={props.onOpenBot}
          />
        </Show>
      </div>
    </div>
  );
}
