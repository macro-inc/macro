import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import type { Accessor } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import { cn } from '@ui/utils/classname';
import {
  getActiveTranscriptSequenceNum,
  getSegmentVideoSeconds,
  sortTranscriptSegments,
} from '../transcript-playback';
import type { CallTranscriptTarget } from '../CallBlockAdapter';
import {
  CallRecordingMediaColumn,
  type CallRecordingTimeUpdateSource,
} from './CallRecordingMediaColumn';
import { CallRecordingMetaStrip } from './CallRecordingMetaStrip';
import { CallRecordingSplitHeader } from './CallRecordingSplitHeader';
import { CallRecordingTranscriptColumn } from './CallRecordingTranscriptColumn';
import {
  isCallRecordingStackedLayout,
  seekDedupeKey,
  shouldCoalesceSeekGenerationBump,
} from './call-recording-utils';

export function CallRecordingBody(props: {
  data: Accessor<CallRecord>;
  transcriptTarget?: Accessor<CallTranscriptTarget | undefined>;
}) {
  const record = props.data;
  const hasTranscripts = createMemo(() => record().transcript.length > 0);
  const [playbackSeconds, setPlaybackSeconds] = createSignal(0);
  const [allowFutureLead, setAllowFutureLead] = createSignal(true);
  const [videoRef, setVideoRef] = createSignal<HTMLVideoElement>();
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  const [isStacked, setIsStacked] = createSignal(false);
  const sortedTranscript = createMemo(() =>
    sortTranscriptSegments(record().transcript)
  );

  // Anchor transcript-to-audio sync to the recording's actual start when
  // available. `startedAt` is call-creation time; the room composite egress
  // starts a few seconds later, so using `startedAt` makes the audio
  // appear to lag the transcript on every segment. `recordingStartedAt`
  // (captured from the LiveKit `egress_started` webhook) is the encoder's
  // true t=0. Falls back to `startedAt` for older records.
  const timelineStartMs = createMemo(() => {
    const anchor = record().recordingStartedAt ?? record().startedAt;
    const ms = new Date(anchor).getTime();
    return Number.isFinite(ms) ? ms : null;
  });

  const [transcriptOpen, setTranscriptOpen] = createSignal(true);
  const [participantsOpen, setParticipantsOpen] = createSignal(false);
  const [layoutDefaultsSeeded, setLayoutDefaultsSeeded] = createSignal(false);
  const [suppressWideParticipantsMotion, setSuppressWideParticipantsMotion] =
    createSignal(false);
  const [participantsContentRef, setParticipantsContentRef] =
    createSignal<HTMLDivElement>();
  const [participantsContentHeight, setParticipantsContentHeight] =
    createSignal(0);
  const [videoSeekGeneration, setVideoSeekGeneration] = createSignal(0);
  let lastVideoSeekBumpKey: string | null = null;
  let lastVideoSeekBumpAtMs = 0;
  let prevLayoutStacked: boolean | undefined;

  const bumpVideoSeekGeneration = (seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    const key = seekDedupeKey(seconds);
    const now = performance.now();
    if (
      shouldCoalesceSeekGenerationBump(
        key,
        now,
        lastVideoSeekBumpKey,
        lastVideoSeekBumpAtMs
      )
    )
      return;
    lastVideoSeekBumpKey = key;
    lastVideoSeekBumpAtMs = now;
    setVideoSeekGeneration((n) => n + 1);
  };

  const activeSequenceNum = createMemo(() =>
    getActiveTranscriptSequenceNum(
      sortedTranscript(),
      playbackSeconds(),
      timelineStartMs(),
      allowFutureLead()
    )
  );

  const handleTimeUpdate = (
    seconds: number,
    source: CallRecordingTimeUpdateSource
  ) => {
    setPlaybackSeconds(seconds);
    setAllowFutureLead(source === 'playback');
    if (source === 'seeked') bumpVideoSeekGeneration(seconds);
  };

  const seekToSeconds = (seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    const video = videoRef();
    const maxTime = Number.isFinite(video?.duration ?? Number.NaN)
      ? (video!.duration as number)
      : seconds;
    const targetSeconds = Math.max(0, Math.min(seconds, maxTime));

    setPlaybackSeconds(targetSeconds);
    setAllowFutureLead(false);
    bumpVideoSeekGeneration(targetSeconds);

    if (video) video.currentTime = targetSeconds;
  };

  const goToTranscriptSegment = (transcriptId: string) => {
    const segment = sortedTranscript().find(
      (s) => s.transcriptId === transcriptId
    );
    if (!segment) return;
    const seconds = getSegmentVideoSeconds(segment, timelineStartMs());
    if (seconds === null) return;
    seekToSeconds(seconds);
  };

  createEffect(
    on(
      () => props.transcriptTarget?.(),
      (target) => {
        if (!target) return;
        if (hasTranscripts()) setTranscriptOpen(true);
        goToTranscriptSegment(target.transcriptId);
      }
    )
  );

  const toggleTranscript = () => {
    setTranscriptOpen((open) => {
      const next = !open;
      if (next && isStacked()) setParticipantsOpen(false);
      return next;
    });
  };

  const toggleParticipants = () => {
    setParticipantsOpen((open) => {
      const next = !open;
      if (next && isStacked()) setTranscriptOpen(false);
      return next;
    });
  };

  createEffect(() => {
    const el = containerRef();
    if (!el) return;

    const updateLayout = () => {
      const stacked = isCallRecordingStackedLayout(el.clientWidth);
      setIsStacked(stacked);

      if (!layoutDefaultsSeeded()) {
        if (!stacked) setSuppressWideParticipantsMotion(true);
        setParticipantsOpen(!stacked);
        setLayoutDefaultsSeeded(true);
        prevLayoutStacked = stacked;
        queueMicrotask(() => setSuppressWideParticipantsMotion(false));
        return;
      }

      const prev = prevLayoutStacked;
      if (prev !== undefined && prev !== stacked) {
        if (stacked) {
          if (transcriptOpen() && participantsOpen())
            setParticipantsOpen(false);
        } else {
          setSuppressWideParticipantsMotion(true);
          setTranscriptOpen(hasTranscripts());
          setParticipantsOpen(true);
          queueMicrotask(() => setSuppressWideParticipantsMotion(false));
        }
      }

      prevLayoutStacked = stacked;
    };

    const observer = new ResizeObserver(updateLayout);
    observer.observe(el);
    untrack(() => updateLayout());
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    const el = participantsContentRef();
    if (!el) return;
    const updateHeight = () => setParticipantsContentHeight(el.scrollHeight);
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });

  return (
    <>
      <CallRecordingSplitHeader record={record} />
      <CallRecordingMetaStrip
        record={record()}
        transcriptOpen={transcriptOpen()}
        participantsOpen={participantsOpen()}
        onToggleTranscript={toggleTranscript}
        onToggleParticipants={toggleParticipants}
      />
      <div
        ref={setContainerRef}
        class={cn(
          'grid min-h-0 flex-1 overflow-hidden grid-cols-1',
          isStacked()
            ? 'grid-rows-1'
            : 'transition-[grid-template-columns] duration-300 linear grid-rows-1',
          !isStacked() &&
            (transcriptOpen()
              ? 'grid-cols-[minmax(0,6fr)_minmax(0,4fr)]'
              : 'grid-cols-[minmax(0,1fr)_minmax(0,0fr)]')
        )}
      >
        <div class="contents @[860px]:contents">
          <CallRecordingMediaColumn
            record={record}
            hasTranscripts={hasTranscripts}
            isStacked={isStacked}
            participantsOpen={participantsOpen}
            suppressWideParticipantsMotion={suppressWideParticipantsMotion}
            participantsContentHeight={participantsContentHeight}
            setParticipantsContentRef={setParticipantsContentRef}
            onTimeUpdate={handleTimeUpdate}
            setVideoRef={setVideoRef}
          />
          <CallRecordingTranscriptColumn
            record={record}
            hasTranscripts={hasTranscripts}
            isStacked={isStacked}
            transcriptOpen={transcriptOpen}
            participantsOpen={participantsOpen}
            activeSequenceNum={activeSequenceNum}
            timelineStartMs={timelineStartMs}
            videoSeekGeneration={videoSeekGeneration}
            onToggleTranscript={toggleTranscript}
            onToggleParticipants={toggleParticipants}
            onSeekToSeconds={seekToSeconds}
          />
        </div>
      </div>
    </>
  );
}
