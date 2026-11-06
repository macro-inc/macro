import { UserIcon } from '@core/component/UserIcon';
import { idToEmail } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { useOpenDirectMessage } from '@core/util/open-direct-message';
import type { CallRecord } from '@service-call/client';
import { Avatar } from '@ui';
import { createMemo, For } from 'solid-js';
import { dedupeCallRecordingParticipants } from './call-recording-utils';

export function CallRecordingParticipantsSection(props: {
  record: CallRecord;
}) {
  const openDm = useOpenDirectMessage();
  const participants = createMemo(() =>
    dedupeCallRecordingParticipants(
      props.record.participants,
      props.record.createdBy
    )
  );
  const guests = () => props.record.guests;

  const openDirectMessage = (participantId: string, event: MouseEvent) => {
    fireAndForget(
      openDm(participantId, { activate: true, preferNewSplit: event.shiftKey }),
      'call-recording-participants'
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

/** Compact identity row; the full participant list remains available in details. */
export function CallRecordingAvatars(props: { record: CallRecord }) {
  const participants = createMemo(() =>
    dedupeCallRecordingParticipants(
      props.record.participants,
      props.record.createdBy
    )
  );
  return (
    <div
      class="flex shrink-0 items-center -space-x-1"
      aria-label="Participants"
    >
      <For each={participants()}>
        {(participant) => (
          <UserIcon id={participant.userId} size="sm" isDeleted={false} />
        )}
      </For>
      <For each={props.record.guests}>
        {(guest) => (
          <Avatar size="sm">
            <Avatar.Fallback>
              {(guest.displayName.trim() || 'Guest').charAt(0).toUpperCase()}
            </Avatar.Fallback>
          </Avatar>
        )}
      </For>
    </div>
  );
}
