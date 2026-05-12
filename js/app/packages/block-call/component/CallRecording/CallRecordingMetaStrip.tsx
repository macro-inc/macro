import { CallAgainButton } from '@channel/Call/CallAgainButton';
import Subtitles from '@phosphor-icons/core/assets/regular/subtitles.svg';
import SubtitlesSlash from '@phosphor-icons/core/assets/regular/subtitles-slash.svg';
import UserCircle from '@phosphor-icons/core/assets/regular/user-circle.svg';
import UserCircleMinus from '@phosphor-icons/core/assets/regular/user-circle-minus.svg';
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import { cn } from '@ui';
import { format } from 'date-fns';
import { Show } from 'solid-js';
import { formatCallDuration } from '../../utils';
import {
  CALL_META_STRIP_TOGGLE_ACTIVE,
  CALL_META_STRIP_TOGGLE_IDLE,
} from './call-recording-utils';

function formatCallDate(dateStr: string): string {
  return format(new Date(dateStr), 'MMM d, yyyy h:mm a');
}

export function CallRecordingMetaStrip(props: {
  record: CallRecord;
  transcriptOpen: boolean;
  participantsOpen: boolean;
  onToggleTranscript: () => void;
  onToggleParticipants: () => void;
}) {
  return (
    <div class="flex shrink-0 items-center justify-between gap-3 border-b border-edge-muted/50 px-4 py-2">
      <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
        <Show when={props.record.endedAt}>
          {(endedAt) => <span>{formatCallDate(endedAt())}</span>}
        </Show>
        <Show when={props.record.durationMs}>
          {(ms) => (
            <>
              <span>&middot;</span>
              <span>{formatCallDuration(ms())}</span>
            </>
          )}
        </Show>
        <Show when={props.record.isActive}>
          <span class="text-success font-medium">In progress</span>
        </Show>
      </div>
      <div class="flex items-center gap-1.5">
        <Show when={!props.record.isActive}>
          <CallAgainButton
            channelId={props.record.channelId}
            class={cn(CALL_META_STRIP_TOGGLE_IDLE, 'shrink-0')}
          />
        </Show>
        <button
          type="button"
          class={cn(
            'shrink-0',
            props.transcriptOpen
              ? CALL_META_STRIP_TOGGLE_ACTIVE
              : CALL_META_STRIP_TOGGLE_IDLE
          )}
          aria-expanded={props.transcriptOpen}
          aria-label={
            props.transcriptOpen ? 'Hide transcript' : 'Show transcript'
          }
          title={props.transcriptOpen ? 'Hide transcript' : 'Show transcript'}
          onClick={() => props.onToggleTranscript()}
        >
          <Show when={props.transcriptOpen}>
            <Subtitles class="size-4 shrink-0" />
          </Show>
          <Show when={!props.transcriptOpen}>
            <SubtitlesSlash class="size-4 shrink-0" />
          </Show>
        </button>
        <button
          type="button"
          class={cn(
            'shrink-0',
            props.participantsOpen
              ? CALL_META_STRIP_TOGGLE_ACTIVE
              : CALL_META_STRIP_TOGGLE_IDLE
          )}
          aria-expanded={props.participantsOpen}
          aria-label={
            props.participantsOpen ? 'Hide participants' : 'Show participants'
          }
          title={
            props.participantsOpen ? 'Hide participants' : 'Show participants'
          }
          onClick={() => props.onToggleParticipants()}
        >
          <Show when={props.participantsOpen}>
            <UserCircle class="size-4 shrink-0" />
          </Show>
          <Show when={!props.participantsOpen}>
            <UserCircleMinus class="size-4 shrink-0" />
          </Show>
        </button>
      </div>
    </div>
  );
}
