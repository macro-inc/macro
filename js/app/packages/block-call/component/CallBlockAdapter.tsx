import { useBlockId } from '@core/block';
import Unauthorized from '@core/component/AccessErrorViews/Unauthorized';
import { MaybeResultError } from '@core/util/maybeResult';
import { useCallRecordQuery } from '@queries/call/call';
import { createSignal, Match, Show, Switch } from 'solid-js';
import { CallTranscript } from './CallTranscript';
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import { format } from 'date-fns';
import PhoneCallIcon from '@macro-icons/wide/call.svg';
import ChevronDownIcon from '@icon/regular/caret-down.svg?component-solid';
import { cn } from '@ui/utils/classname';
import { formatCallDuration } from '../utils';

function isUnauthorized(error: Error | null): boolean {
  if (error instanceof MaybeResultError) {
    return error.errors[0]?.code === 'UNAUTHORIZED';
  }
  return false;
}

function formatCallDate(dateStr: string): string {
  return format(new Date(dateStr), 'MMM d, yyyy h:mm a');
}

function CallSummary(props: { summary: string }) {
  const [expanded, setExpanded] = createSignal(true);
  return (
    <div class="px-4 py-3 border-b border-edge">
      <button
        type="button"
        class="flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink"
        aria-expanded={expanded()}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <ChevronDownIcon
          class={cn('w-3 h-3 transition-transform duration-100', {
            'rotate-180': expanded(),
            '-rotate-90': !expanded(),
          })}
        />
        <span>AI summary</span>
      </button>
      <Show when={expanded()}>
        <div class="mt-2 text-sm text-ink whitespace-pre-wrap">
          {props.summary}
        </div>
      </Show>
    </div>
  );
}

function CallHeader(props: { record: CallRecord }) {
  return (
    <div class="px-4 py-3 border-b border-edge shrink-0 flex items-center gap-3">
      <PhoneCallIcon class="size-5 text-ink-muted shrink-0" />
      <div class="flex flex-col min-w-0">
        <h2 class="text-sm font-medium text-ink truncate">
          {props.record.customName ?? props.record.channelName ?? 'Call'}
        </h2>
        <div class="flex items-center gap-2 text-xs text-ink-muted">
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
      </div>
    </div>
  );
}

export function CallBlockAdapter() {
  const callId = useBlockId();
  const callRecord = useCallRecordQuery(() => callId);

  return (
    <div class="h-full flex flex-col overflow-hidden">
      <Show
        when={callRecord.data}
        fallback={
          <div class="px-4 py-3 border-b border-edge shrink-0">
            <h2 class="text-sm font-medium text-ink">Call Recording</h2>
          </div>
        }
      >
        {(data) => <CallHeader record={data()} />}
      </Show>
      <div class="flex-1 overflow-y-auto">
        <Switch>
          <Match when={callRecord.isLoading}>
            <div class="flex items-center justify-center h-full text-ink-faint text-sm">
              Loading call...
            </div>
          </Match>
          <Match when={callRecord.isError && isUnauthorized(callRecord.error)}>
            <Unauthorized />
          </Match>
          <Match when={callRecord.isError}>
            <div class="flex items-center justify-center h-full text-failure text-sm">
              Failed to load call recording.
            </div>
          </Match>
          <Match when={callRecord.data}>
            {(data) => (
              <>
                <Show when={data().recordingUrl}>
                  {(url) => (
                    <div class="p-4 border-b border-edge flex justify-center">
                      <video
                        class="w-3/4 rounded"
                        controls
                        crossorigin="anonymous"
                        src={url()}
                      />
                    </div>
                  )}
                </Show>
                <Show when={data().summary}>
                  {(summary) => <CallSummary summary={summary()} />}
                </Show>
                <Show
                  when={data().transcript.length > 0}
                  fallback={
                    <Show when={!data().recordingUrl && !data().summary}>
                      <div class="flex items-center justify-center h-full text-ink-faint text-sm">
                        No recording or transcript available.
                      </div>
                    </Show>
                  }
                >
                  <CallTranscript
                    transcript={data().transcript}
                    channelId={data().channelId}
                  />
                </Show>
              </>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  );
}
