import { useSplitLayout } from '@app/component/split-layout/layout';
import { useUserId } from '@core/context/user';
import { useChannelType } from '@core/context/channels';
import { isOk } from '@core/util/maybeResult';
import {
  useAddParticipantsMutation,
  useRemoveParticipantsMutation,
} from '@queries/channel/participants';
import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';
import { commsServiceClient } from '@service-comms/client';
import { ChannelType } from '@service-comms/generated/models/channelType';
import { createSignal, Show } from 'solid-js';
import { idToEmail } from '@core/user';
import { ParticipantsAddPanel } from './ParticipantsAddPanel';
import { ParticipantsList } from './ParticipantsList';
import { ParticipantsSearchInput } from './ParticipantsSearchInput';

function ParticipantsSection(props: {
  title: string;
  children: import('solid-js').JSX.Element;
  class?: string;
  contentClass?: string;
}) {
  return (
    <div
      class={`rounded-sm border border-edge-muted bg-menu py-3 ${props.class ?? ''}`}
    >
      <div class="px-3 pb-3 text-sm font-medium text-ink">{props.title}</div>
      <div class="border-b border-edge-muted" />
      <div class={`px-3 pt-3 ${props.contentClass ?? ''}`}>
        {props.children}
      </div>
    </div>
  );
}

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
    const channelId = isOk(result) && result[1]?.channel_id;

    if (channelId) {
      replaceOrInsertSplit({
        type: 'channel',
        id: channelId,
      });
    }
  };

  return (
    <div class="relative flex-1 min-h-0 overflow-hidden">
      <div class="macro-message-width macro-message-padding mx-auto flex h-full min-h-0 w-full flex-col gap-6 py-4">
        <Show when={canAddParticipants()}>
          <ParticipantsSection title="Add participants">
            <ParticipantsAddPanel
              participants={participants}
              onAddParticipants={addParticipants}
            />
          </ParticipantsSection>
        </Show>
        <ParticipantsSection
          title="Participants"
          class="flex flex-1 min-h-0 flex-col md:flex-none"
          contentClass="flex flex-1 min-h-0 flex-col"
        >
          <ParticipantsSearchInput
            value={searchQuery()}
            onInput={setSearchQuery}
          />
          <div class="min-h-0 flex-1 pt-2">
            <ParticipantsList
              participants={filteredParticipants}
              searchQuery={searchQuery}
              currentUserId={userId() ?? undefined}
              editable={canManageParticipants()}
              onParticipantClick={openDirectMessage}
              onRemoveParticipant={removeParticipant}
            />
          </div>
        </ParticipantsSection>
      </div>
    </div>
  );
}
