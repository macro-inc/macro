import { useSplitLayout } from '@app/component/split-layout/layout';
import { UserIcon } from '@core/component/UserIcon';
import { idToEmail } from '@core/user';
import { isOk } from '@core/util/maybeResult';
import { ParticipantsEmptyState } from '@channel/Participants/ParticipantsEmptyState';
import { ParticipantsSearchInput } from '@channel/Participants/ParticipantsSearchInput';
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import { commsServiceClient } from '@service-comms/client';
import UsersThree from '@phosphor-icons/core/assets/regular/users-three.svg';
import type { Accessor } from 'solid-js';
import { For, Show, createMemo, createSignal } from 'solid-js';
import { CallRecordingSectionShell } from './CallRecordingSectionShell';
import { dedupeCallRecordingParticipants } from './call-recording-utils';

export function CallRecordingParticipantsSection(props: {
  record: Accessor<CallRecord>;
  withShell?: boolean;
  open?: boolean;
}) {
  const { replaceOrInsertSplit } = useSplitLayout();
  const [searchQuery, setSearchQuery] = createSignal('');
  const participants = createMemo(() =>
    dedupeCallRecordingParticipants(
      props.record().participants,
      props.record().createdBy
    )
  );
  const filteredParticipants = createMemo(() => {
    const query = searchQuery().trim().toLowerCase();
    if (query.length === 0) return participants();
    return participants().filter((participant) => {
      const email = idToEmail(participant.userId).toLowerCase();
      return (
        email.includes(query) ||
        participant.userId.toLowerCase().includes(query) ||
        participant.role.includes(query)
      );
    });
  });

  const openDirectMessage = async (participantId: string) => {
    const result = await commsServiceClient.getOrCreateDirectMessage({
      recipient_id: participantId,
    });
    const channelId = isOk(result) && result[1]?.channel_id;
    if (!channelId) return;
    replaceOrInsertSplit({
      type: 'channel',
      id: channelId,
    });
  };

  const body = (
    <div class="min-h-0 flex h-full flex-col gap-2 p-4 pt-3">
      <ParticipantsSearchInput value={searchQuery()} onInput={setSearchQuery} />
      <Show
        when={filteredParticipants().length > 0}
        fallback={<ParticipantsEmptyState searchQuery={searchQuery()} />}
      >
        <div class="min-h-0 flex-1 overflow-y-auto scrollbar-hidden">
          <div class="flex flex-col border-t border-edge-muted/50">
            <For each={filteredParticipants()}>
              {(participant) => (
                <button
                  type="button"
                  class="flex items-center gap-2 min-h-10 px-2 py-2 text-sm w-full border-b border-edge-muted/50 last:border-b-0 hover:bg-hover text-left "
                  onClick={() => openDirectMessage(participant.userId)}
                >
                  <div class="shrink-0">
                    <UserIcon
                      id={participant.userId}
                      size="sm"
                      isDeleted={false}
                    />
                  </div>
                  <span class="font-semibold truncate flex-1 text-ink">
                    {idToEmail(participant.userId)}
                  </span>
                  <span class="text-xs font-mono text-ink-extra-muted uppercase font-light shrink-0">
                    {participant.role}
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );

  if (props.withShell === false) return body;

  return (
    <CallRecordingSectionShell
      title="Participants"
      icon={<UsersThree class="size-4 text-ink shrink-0" />}
      open={props.open}
    >
      {body}
    </CallRecordingSectionShell>
  );
}
