import { useSplitLayout } from '@app/component/split-layout/layout';
import { useChannelType } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { idToEmail } from '@core/user';

import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';
import {
  useAddParticipantsMutation,
  useRemoveParticipantsMutation,
} from '@queries/channel/participants';
import { commsServiceClient } from '@service-comms/client';
import { ChannelType } from '@service-comms/generated/models/channelType';
import { Panel } from '@ui';
import { createSignal, Show } from 'solid-js';
import { ParticipantsAddPanel } from './ParticipantsAddPanel';
import { ParticipantsList } from './ParticipantsList';
import { ParticipantsSearchInput } from './ParticipantsSearchInput';

export function ChannelParticipantsTab(props: { channelId: string }) {
  const { replaceOrInsertSplit } = useSplitLayout();
  const userId = useUserId();
  const channelType = useChannelType(props.channelId);
  const participantsQuery = useChannelParticipantsQuery(() => props.channelId);
  const addParticipantsMutation = useAddParticipantsMutation();
  const removeParticipantsMutation = useRemoveParticipantsMutation();
  const [searchQuery, setSearchQuery] = createSignal('');

  const participants = () => participantsQuery.data ?? [];
  const canManageParticipants = () =>
    channelType() !== ChannelType.organization;
  const canAddParticipants = () =>
    canManageParticipants() && channelType() === ChannelType.private;

  const filteredParticipants = () => {
    const query = searchQuery().trim().toLowerCase();
    if (query.length === 0) return participants();

    return participants().filter((participant) => {
      const email = idToEmail(participant.user_id).toLowerCase();
      return (
        participant.user_id.toLowerCase().includes(query) ||
        email.includes(query) ||
        participant.role.toLowerCase().includes(query)
      );
    });
  };

  const addParticipants = (participantIds: string[]) => {
    if (participantIds.length === 0) return;

    addParticipantsMutation.mutate({
      channelId: props.channelId,
      participants: participantIds,
    });
  };

  const removeParticipant = (participantId: string) => {
    removeParticipantsMutation.mutate({
      channelId: props.channelId,
      participants: [participantId],
    });
  };

  const openDirectMessage = async (participantId: string) => {
    const result = await commsServiceClient.getOrCreateDirectMessage({
      recipient_id: participantId,
    });
    const channelId = result.isOk() && result.value?.channel_id;

    if (channelId) {
      replaceOrInsertSplit({
        type: 'channel',
        id: channelId,
      });
    }
  };

  return (
    <div class="h-full overflow-hidden flex justify-center p-2">
      <div class="max-w-200 size-full">
        <Panel depth={2} class="h-full overflow-hidden text-ink">
          <Panel.Header class="px-6">
            <div class="text-sm font-semibold">Participants</div>
          </Panel.Header>
          <Panel.Toolbar class="h-15.25 px-2">
            <ParticipantsSearchInput
              value={searchQuery()}
              onInput={setSearchQuery}
            />
          </Panel.Toolbar>
          <Panel.Body>
            <div class="flex h-full flex-col">
              <Show when={canAddParticipants()}>
                <div class="px-6 py-3 border-b border-edge-muted shrink-0">
                  <ParticipantsAddPanel
                    participants={participants}
                    onAddParticipants={addParticipants}
                  />
                </div>
              </Show>
              <div class="relative min-h-0 flex-1">
                <ParticipantsList
                  participants={filteredParticipants}
                  searchQuery={searchQuery}
                  currentUserId={userId() ?? undefined}
                  editable={canManageParticipants()}
                  onParticipantClick={openDirectMessage}
                  onRemoveParticipant={removeParticipant}
                />
              </div>
            </div>
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}
