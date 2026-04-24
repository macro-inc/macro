import { useBlockId } from '@core/block';
import Unauthorized from '@core/component/AccessErrorViews/Unauthorized';
import { MaybeResultError } from '@core/util/maybeResult';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { UserIcon } from '@core/component/UserIcon';
import { useCallRecordQuery } from '@queries/call/call';
import type { Accessor } from 'solid-js';
import {
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import { CallTranscript } from './CallTranscript';
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import { format } from 'date-fns';
import PhoneCallIcon from '@macro-icons/wide/call.svg';
import Eye from '@phosphor-icons/core/assets/regular/eye.svg';
import EyeSlash from '@phosphor-icons/core/assets/regular/eye-slash.svg';
import { cn } from '@ui/utils/classname';
import { formatCallDuration } from '../utils';
import { idToEmail } from '@core/user';
import { ParticipantsEmptyState } from '@channel/Participants/ParticipantsEmptyState';
import { ParticipantsSearchInput } from '@channel/Participants/ParticipantsSearchInput';
import { commsServiceClient } from '@service-comms/client';
import { isOk } from '@core/util/maybeResult';
import {
  getActiveTranscriptSequenceNum,
  sortTranscriptSegments,
} from './transcript-playback';

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

function CallParticipantsSection(props: { record: Accessor<CallRecord> }) {
  const { replaceOrInsertSplit } = useSplitLayout();
  const [searchQuery, setSearchQuery] = createSignal('');
  const participants = createMemo(() => {
    const unique = new Map<
      string,
      { userId: string; joinedAt: string; role: 'organizer' | 'participant' }
    >();
    for (const participant of props.record().participants) {
      const prev = unique.get(participant.userId);
      if (!prev || participant.joinedAt < prev.joinedAt) {
        unique.set(participant.userId, {
          userId: participant.userId,
          joinedAt: participant.joinedAt,
          role:
            participant.userId === props.record().createdBy
              ? 'organizer'
              : 'participant',
        });
      }
    }
    return Array.from(unique.values()).sort((a, b) =>
      a.joinedAt.localeCompare(b.joinedAt)
    );
  });
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

  return (
    <div class="px-4 pb-4">
      <div class="rounded-sm border border-edge-muted bg-menu py-3">
        <div class="px-3 pb-3 text-sm font-medium text-ink">Participants</div>
        <div class="border-b border-edge-muted" />
        <div class="px-3 pt-3 flex flex-col gap-2">
          <ParticipantsSearchInput
            value={searchQuery()}
            onInput={setSearchQuery}
          />
          <Show
            when={filteredParticipants().length > 0}
            fallback={<ParticipantsEmptyState searchQuery={searchQuery()} />}
          >
            <div class="flex flex-col">
              <For each={filteredParticipants()}>
                {(participant) => (
                  <button
                    type="button"
                    class="flex items-center gap-2 min-h-10 px-2 py-2 text-sm w-full border-b border-edge-muted/50 last:border-b-0 hover:bg-hover/30 rounded-xs text-left cursor-pointer"
                    onClick={() => openDirectMessage(participant.userId)}
                  >
                    <div class="shrink-0">
                      <UserIcon id={participant.userId} size="xs" isDeleted={false} />
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
          </Show>
        </div>
      </div>
    </div>
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
        <Show when={props.transcriptOpen}><Eye class="size-4 shrink-0" /></Show>

        <Show when={!props.transcriptOpen}><EyeSlash class="size-4 shrink-0" /></Show>

        <span>Transcript</span>
      </button>
    </div>
  );
}

function RecordingVideo(props: {
  url: string;
  onTimeUpdate?: (seconds: number, source: 'playback' | 'seek') => void;
  setVideoRef?: (el: HTMLVideoElement) => void;
}) {
  const [isLoaded, setIsLoaded] = createSignal(false);
  let rafId: number | null = null;

  const stopTicking = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const startTicking = (video: HTMLVideoElement) => {
    stopTicking();
    const tick = () => {
      props.onTimeUpdate?.(video.currentTime, 'playback');
      if (!video.paused && !video.ended) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
      }
    };
    rafId = requestAnimationFrame(tick);
  };
  onCleanup(stopTicking);

  return (
    <div class="p-4 h-full min-h-0 flex justify-center items-start overflow-hidden">
      <video
        ref={props.setVideoRef}
        class="max-w-full max-h-full rounded transition-opacity duration-200"
        classList={{ 'opacity-0': !isLoaded(), 'opacity-100': isLoaded() }}
        controls
        crossorigin="anonymous"
        src={props.url}
        onLoadedData={() => setIsLoaded(true)}
        onCanPlay={() => setIsLoaded(true)}
        onPlaying={(event) => {
          setIsLoaded(true);
          startTicking(event.currentTarget);
        }}
        onPlay={(event) => startTicking(event.currentTarget)}
        onPause={() => stopTicking()}
        onSeeking={(event) =>
          props.onTimeUpdate?.(event.currentTarget.currentTime, 'seek')
        }
        onSeeked={(event) =>
          props.onTimeUpdate?.(event.currentTarget.currentTime, 'seek')
        }
        onEnded={(event) => {
          stopTicking();
          props.onTimeUpdate?.(event.currentTarget.duration, 'playback');
        }}
        onTimeUpdate={(event) =>
          props.onTimeUpdate?.(event.currentTarget.currentTime, 'playback')
        }
        onLoadedMetadata={(event) =>
          props.onTimeUpdate?.(event.currentTarget.currentTime, 'playback')
        }
      />
    </div>
  );
}

function CallRecordingBody(props: { data: Accessor<CallRecord> }) {
  const record = props.data;
  const hasTranscripts = () => record().transcript.length > 0;
  const [playbackSeconds, setPlaybackSeconds] = createSignal(0);
  const [allowFutureLead, setAllowFutureLead] = createSignal(true);
  const [videoRef, setVideoRef] = createSignal<HTMLVideoElement>();
  const sortedTranscript = createMemo(() =>
    sortTranscriptSegments(record().transcript)
  );

  const [transcriptOpen, setTranscriptOpen] = createSignal(true);
  const activeSequenceNum = () =>
    getActiveTranscriptSequenceNum(
      sortedTranscript(),
      playbackSeconds(),
      allowFutureLead()
    );
  const handleTimeUpdate = (seconds: number, source: 'playback' | 'seek') => {
    setPlaybackSeconds(seconds);
    setAllowFutureLead(source === 'playback');
  };
  const seekToSeconds = (seconds: number) => {
    const video = videoRef();
    if (!video || !Number.isFinite(seconds)) return;
    const maxTime = Number.isFinite(video.duration) ? video.duration : seconds;
    const targetSeconds = Math.max(0, Math.min(seconds, maxTime));
    video.currentTime = targetSeconds;
    setPlaybackSeconds(targetSeconds);
    setAllowFutureLead(false);
  };

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
                <RecordingVideo
                  url={url}
                  onTimeUpdate={handleTimeUpdate}
                  setVideoRef={setVideoRef}
                />
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
          <CallParticipantsSection record={record} />
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
                activeSequenceNum={activeSequenceNum()}
                onSeekToSeconds={seekToSeconds}
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
