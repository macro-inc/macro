import { useSplitLayout } from '@app/component/split-layout/layout';
import { UserIcon } from '@core/component/UserIcon';
import { idToEmail } from '@core/user';
import { isOk } from '@core/util/maybeResult';
import { commsServiceClient } from '@service-comms/client';
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import type { Accessor } from 'solid-js';
import { createMemo, For } from 'solid-js';
import { dedupeCallRecordingParticipants } from './call-recording-utils';

export function CallRecordingParticipantsSection(props: {
  record: Accessor<CallRecord>;
}) {
  const { replaceOrInsertSplit } = useSplitLayout();
  const participants = createMemo(() =>
    dedupeCallRecordingParticipants(
      props.record().participants,
      props.record().createdBy
    )
  );

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

  return (
    <section class="flex flex-col gap-3">
      <h3 class="text-sm font-semibold text-ink">
        Participants
        <span class="ml-1.5 text-ink-muted font-normal tabular-nums">
          {participants().length}
        </span>
      </h3>
      <div class="flex flex-wrap gap-2" role="list">
        <For each={participants()}>
          {(participant) => (
            <button
              type="button"
              role="listitem"
              class="inline-flex items-center gap-1.5 rounded-full border border-edge-muted/50 py-1 pr-2.5 pl-1 text-sm text-ink transition-colors hover:bg-hover"
              onClick={() => openDirectMessage(participant.userId)}
            >
              <UserIcon id={participant.userId} size="sm" isDeleted={false} />
              <span class="truncate max-w-48">
                {idToEmail(participant.userId)}
              </span>
            </button>
          )}
        </For>
      </div>
    </section>
  );
}
