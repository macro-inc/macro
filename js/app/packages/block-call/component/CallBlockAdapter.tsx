import { useBlockId } from '@core/block';
import Unauthorized from '@core/component/AccessErrorViews/Unauthorized';
import { MaybeResultError } from '@core/util/maybeResult';
import { useCallRecordQuery } from '@queries/call/call';
import { Match, Show, Switch, createSignal } from 'solid-js';
import { CallTranscript } from './CallTranscript';
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import { format } from 'date-fns';
import PhoneCallIcon from '@macro-icons/wide/call.svg';
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

function CallHeader(props: { record: CallRecord }) {
  return (
    <div class="px-4 py-3 border-b border-edge-muted/50 shrink-0 flex items-center gap-3">
      <PhoneCallIcon class="size-5 text-ink-muted shrink-0" />
      <div class="flex flex-col min-w-0">
        <h2 class="text-sm font-medium text-ink truncate">
          {props.record.channelName ?? 'Call'}
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

function RecordingVideo(props: { url: string }) {
  const [isLoaded, setIsLoaded] = createSignal(false);

  return (
    <div class="p-4 border-b border-edge flex justify-center">
      <div class="relative w-3/4 max-w-4xl aspect-video rounded bg-surface-2 overflow-hidden">
        <div
          class="absolute inset-0 z-0 animate-pulse bg-surface-3 transition-opacity duration-200"
          classList={{ 'opacity-100': !isLoaded(), 'opacity-0': isLoaded() }}
        />
        <video
          class="absolute inset-0 z-10 size-full object-contain transition-opacity duration-200"
          classList={{ 'opacity-0': !isLoaded(), 'opacity-100': isLoaded() }}
          controls
          crossorigin="anonymous"
          src={props.url}
          onLoadedData={() => setIsLoaded(true)}
        />
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
                <Show when={data().recordingUrl} keyed>
                  {(url) => <RecordingVideo url={url} />}
                </Show>
                <Show
                  when={data().transcript.length > 0}
                  fallback={
                    <Show when={!data().recordingUrl}>
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
