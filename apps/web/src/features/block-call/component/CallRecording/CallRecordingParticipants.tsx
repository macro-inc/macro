import { useSplitLayout } from '@components/app/split-layout/layout';
import { UserIcon } from '@core/component/UserIcon';
import { idToEmail } from '@core/user';

import { useGetOrCreateDirectMessageMutation } from '@queries/channel/get-or-create-dm';
import type { CallRecord } from '@service-call/client';
import type { Accessor } from 'solid-js';
import { createMemo, For } from 'solid-js';
import { dedupeCallRecordingParticipants } from './call-recording-utils';

export function CallRecordingParticipantsSection(props: {
  record: Accessor<CallRecord>;
}) {
  const { openWithSplit } = useSplitLayout();
  const getOrCreateDmMutation = useGetOrCreateDirectMessageMutation();
  const participants = createMemo(() =>
    dedupeCallRecordingParticipants(
      props.record().participants,
      props.record().createdBy
    )
  );
  const guests = () => props.record().guests;

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
    <section class="flex flex-col gap-3">
      <h3 class="text-sm font-semibold text-ink">
        Participants
        <span class="ml-1.5 text-ink-muted font-normal tabular-nums">
          {participants().length + guests().length}
        </span>
      </h3>
      <div class="flex flex-wrap gap-2" role="list">
        <For each={participants()}>
          {(participant) => (
            <button
              type="button"
              role="listitem"
              class="inline-flex items-center gap-1.5 rounded-full border border-edge-muted/50 py-1 pr-2.5 pl-1 text-sm text-ink transition-colors hover:bg-hover"
              onClick={(event) => openDirectMessage(participant.userId, event)}
            >
              <UserIcon id={participant.userId} size="sm" isDeleted={false} />
              <span class="truncate max-w-48">
                {idToEmail(participant.userId)}
              </span>
            </button>
          )}
        </For>
        <For each={guests()}>
          {(guest) => (
            <span
              role="listitem"
              class="inline-flex items-center gap-1.5 rounded-full border border-edge-muted/50 py-1 pr-2.5 pl-1 text-sm text-ink"
            >
              <span class="flex size-6 items-center justify-center rounded-full bg-hover text-xs">
                {(guest.displayName.trim() || 'Guest').charAt(0).toUpperCase()}
              </span>
              <span class="truncate max-w-48">
                {`${guest.displayName.trim() || 'Guest'} (guest)`}
              </span>
            </span>
          )}
        </For>
      </div>
    </section>
  );
}
