import { CallAgainButton } from '@channel/Call/CallAgainButton';
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import { format } from 'date-fns';
import { Show } from 'solid-js';
import { formatCallDuration } from '../../utils';
import { CALL_META_STRIP_TOGGLE_IDLE } from './call-recording-utils';

function formatCallDate(dateStr: string): string {
  return format(new Date(dateStr), 'MMM d, yyyy h:mm a');
}

export function CallRecordingMetaStrip(props: { record: CallRecord }) {
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
            class={CALL_META_STRIP_TOGGLE_IDLE + ' shrink-0'}
          />
        </Show>
      </div>
    </div>
  );
}
