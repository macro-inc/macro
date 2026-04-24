import { useBlockId } from '@core/block';
import Unauthorized from '@core/component/AccessErrorViews/Unauthorized';
import { MaybeResultError } from '@core/util/maybeResult';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { useCallRecordQuery } from '@queries/call/call';
import type { Accessor } from 'solid-js';
import {
  Match,
  Show,
  Switch,
  createSignal,
} from 'solid-js';
import { CallTranscript } from './CallTranscript';
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import { format } from 'date-fns';
import PhoneCallIcon from '@macro-icons/wide/call.svg';
import Subtitles from '@phosphor-icons/core/assets/regular/subtitles.svg';
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

function CallSplitHeaderLoading() {
  return (
    <SplitHeaderLeft>
      <div class="h-full my-auto flex min-w-0 items-center justify-start gap-3">
        <div class="ph-no-capture z-3 relative flex h-full max-w-full min-w-0 shrink items-center gap-2">
          <StaticSplitLabel
            label="Call Recording"
            icon={
              <PhoneCallIcon class="size-4 touch:size-6 shrink-0 text-ink-muted" />
            }
          />
        </div>
      </div>
    </SplitHeaderLeft>
  );
}

function CallSplitHeader(props: { record: Accessor<CallRecord> }) {
  const record = props.record;
  return (
    <SplitHeaderLeft>
      <div class="h-full my-auto flex min-w-0 items-center justify-start gap-3">
        <div class="ph-no-capture z-3 relative flex h-full max-w-full min-w-0 shrink items-center gap-2">
          <StaticSplitLabel
            label={record().channelName ?? 'Call'}
            icon={
              <PhoneCallIcon class="size-4 touch:size-6 shrink-0 text-ink-muted" />
            }
          />
        </div>
      </div>
    </SplitHeaderLeft>
  );
}

function CallMetaStrip(props: {
  record: CallRecord;
  transcriptOpen: boolean;
  onToggleTranscript: () => void;
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
      <button
        type="button"
        class="shrink-0 rounded-xs border border-edge-muted/50 px-2 py-1.5 text-xs font-medium text-ink-muted cursor-pointer hover:bg-hover/30 hover:text-ink flex items-center gap-1.5 transition-colors"
        aria-expanded={props.transcriptOpen}
        aria-label={
          props.transcriptOpen ? 'Hide transcript' : 'Show transcript'
        }
        onClick={() => props.onToggleTranscript()}
      >
        <Subtitles class="size-4 shrink-0" />
        <span>{props.transcriptOpen ? 'Hide Transcript' : 'Show Transcript'}</span>
      </button>
    </div>
  );
}

function RecordingVideo(props: { url: string }) {
  const [isLoaded, setIsLoaded] = createSignal(false);

  return (
    <div class="p-4 h-full min-h-0 flex justify-center items-start overflow-hidden">
      <video
        class="max-w-full max-h-full rounded transition-opacity duration-200"
        classList={{ 'opacity-0': !isLoaded(), 'opacity-100': isLoaded() }}
        controls
        crossorigin="anonymous"
        src={props.url}
        onLoadedData={() => setIsLoaded(true)}
        onCanPlay={() => setIsLoaded(true)}
        onPlaying={() => setIsLoaded(true)}
      />
    </div>
  );
}

function CallRecordingBody(props: { data: Accessor<CallRecord> }) {
  const record = props.data;
  const hasTranscripts = () => record().transcript.length > 0;

  const [transcriptOpen, setTranscriptOpen] = createSignal(true);

  return (
    <>
      <CallSplitHeader record={record} />
      <CallMetaStrip
        record={record()}
        transcriptOpen={transcriptOpen()}
        onToggleTranscript={() => setTranscriptOpen((o) => !o)}
      />
      <div
        class={cn(
          'grid min-h-0 flex-1 overflow-hidden transition-[grid-template-columns,grid-template-rows,gap] duration-300 linear grid-cols-1',
          transcriptOpen()
            ? 'grid-rows-[minmax(0,2fr)_minmax(0,3fr)]'
            : 'grid-rows-[minmax(0,1fr)_minmax(0,0fr)]',
          '@[860px]:grid-rows-1',
          transcriptOpen()
            ? '@[860px]:grid-cols-[minmax(0,6fr)_minmax(0,4fr)]'
            : '@[860px]:grid-cols-[minmax(0,1fr)_minmax(0,0fr)]'
        )}
      >
        <div class="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <Show when={record().recordingUrl} keyed>
            {(url) => (
              <div class="min-h-0 flex-1 overflow-hidden">
                <RecordingVideo url={url} />
              </div>
            )}
          </Show>
          <Show when={!record().recordingUrl}>
            <Show
              when={hasTranscripts()}
              fallback={
                <div class="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-sm text-ink-faint">
                  No recording or transcript available.
                </div>
              }
            >
              <div class="flex min-h-[120px] flex-1 items-center justify-center px-4 text-center text-sm text-ink-faint">
                No video recording for this call.
              </div>
            </Show>
          </Show>
        </div>

        <div class="relative min-h-0 min-w-0 overflow-hidden border-edge-muted/50 border-t @[860px]:border-t-0 @[860px]:border-l">
          <div class="flex h-full min-h-0 w-full min-w-0 flex-col @[860px]:min-w-[40cqw]">
            <Show
              when={hasTranscripts()}
              fallback={
                <div class="flex h-full min-h-0 w-full min-w-0 flex-1 items-center justify-center px-4 py-10 text-center text-sm text-ink-muted">
                  No transcripts for this call.
                </div>
              }
            >
              <CallTranscript
                transcript={record().transcript}
                channelId={record().channelId}
              />
            </Show>
          </div>
        </div>
      </div>
    </>
  );
}

export function CallBlockAdapter() {
  const callId = useBlockId();
  const callRecord = useCallRecordQuery(() => callId);

  return (
    <div class="h-full flex flex-col @container">
      <Switch>
        <Match when={callRecord.data}>
          {(data) => <CallRecordingBody data={data} />}
        </Match>
        <Match when={callRecord.isLoading}>
          <>
            <CallSplitHeaderLoading />
            <div class="flex flex-1 min-h-0 items-center justify-center text-sm text-ink-faint">
              Loading call...
            </div>
          </>
        </Match>
        <Match when={callRecord.isError && isUnauthorized(callRecord.error)}>
          <>
            <CallSplitHeaderLoading />
            <div class="flex flex-1 min-h-0 overflow-hidden">
              <Unauthorized />
            </div>
          </>
        </Match>
        <Match when={callRecord.isError}>
          <>
            <CallSplitHeaderLoading />
            <div class="flex flex-1 min-h-0 items-center justify-center text-sm text-failure">
              Failed to load call recording.
            </div>
          </>
        </Match>
      </Switch>
    </div>
  );
}
