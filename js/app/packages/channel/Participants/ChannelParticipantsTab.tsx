import { useSplitLayout } from '@app/component/split-layout/layout';
import { useChannelType } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { idToEmail } from '@core/user';
import { useBotsQuery } from '@queries/bots';
import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';
import {
  useAddParticipantsMutation,
  useRemoveParticipantsMutation,
} from '@queries/channel/participants';
import {
  useAddChannelBotMutation,
  useChannelBotsQuery,
  useRemoveChannelBotMutation,
} from '@queries/channelBots';
import { commsServiceClient } from '@service-comms/client';
import { ChannelType } from '@service-comms/generated/models/channelType';
import { Button, Panel } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { ParticipantsAddPanel } from './ParticipantsAddPanel';
import { ParticipantsList } from './ParticipantsList';
import { ParticipantsSearchInput } from './ParticipantsSearchInput';

export function ChannelParticipantsTab(props: { channelId: string }) {
  const { replaceOrInsertSplit } = useSplitLayout();
  const userId = useUserId();
  const channelType = useChannelType(props.channelId);
  const participantsQuery = useChannelParticipantsQuery(() => props.channelId);
  const manageableBotsQuery = useBotsQuery();
  const botsQuery = useChannelBotsQuery(() => props.channelId);
  const addParticipantsMutation = useAddParticipantsMutation();
  const removeParticipantsMutation = useRemoveParticipantsMutation();
  const addChannelBotMutation = useAddChannelBotMutation();
  const removeChannelBotMutation = useRemoveChannelBotMutation();
  const [searchQuery, setSearchQuery] = createSignal('');

  const participants = () => participantsQuery.data ?? [];
  const currentParticipantRole = () =>
    participants().find((participant) => participant.user_id === userId())
      ?.role;
  const canManageParticipants = () =>
    channelType() !== ChannelType.organization;
  const canManageBots = () =>
    currentParticipantRole() === 'admin' ||
    currentParticipantRole() === 'owner';
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

  const channelBotIds = () =>
    new Set((botsQuery.data ?? []).map((bot) => bot.id));
  const addableBots = () =>
    (manageableBotsQuery.data ?? []).filter(
      (bot) => !channelBotIds().has(bot.id)
    );

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
              <Show when={canManageBots()}>
                <div class="border-t border-edge-muted px-6 py-4">
                  <div class="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div class="text-sm font-semibold">Bots</div>
                      <div class="text-xs text-ink-muted">
                        Add owned or team bots to grant channel reach.
                      </div>
                    </div>
                  </div>
                  <Show when={addableBots().length > 0}>
                    <div class="mb-3 divide-y divide-edge-muted rounded border border-border">
                      <For each={addableBots()}>
                        {(bot) => (
                          <div class="flex items-center justify-between gap-3 px-3 py-2">
                            <div class="min-w-0">
                              <div class="truncate text-sm font-medium">
                                {bot.name}
                              </div>
                              <div class="truncate text-xs text-ink-muted">
                                @{bot.handle}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={addChannelBotMutation.isPending}
                              onClick={() =>
                                addChannelBotMutation.mutate({
                                  channelId: props.channelId,
                                  botId: bot.id,
                                })
                              }
                            >
                              Add
                            </Button>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                  <div class="divide-y divide-edge-muted rounded border border-border">
                    <For
                      each={botsQuery.data ?? []}
                      fallback={
                        <div class="px-3 py-2 text-sm text-ink-muted">
                          No bots yet.
                        </div>
                      }
                    >
                      {(bot) => (
                        <div class="flex items-center justify-between gap-3 px-3 py-2">
                          <div class="min-w-0">
                            <div class="truncate text-sm font-medium">
                              {bot.name}
                            </div>
                            <div class="truncate text-xs text-ink-muted">
                              @{bot.handle}
                            </div>
                          </div>
                          <div class="flex shrink-0 items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={removeChannelBotMutation.isPending}
                              onClick={() =>
                                removeChannelBotMutation.mutate({
                                  channelId: props.channelId,
                                  botId: bot.id,
                                })
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
}
