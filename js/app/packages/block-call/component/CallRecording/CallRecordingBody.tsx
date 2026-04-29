import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import type { Accessor } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import { cn } from '@ui/utils/classname';
import {
  getActiveTranscriptSequenceNum,
  sortTranscriptSegments,
} from '../transcript-playback';
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

export function CallRecordingBody(props: { data: Accessor<CallRecord> }) {
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
    const video = videoRef();
    if (!video || !Number.isFinite(seconds)) return;
    const maxTime = Number.isFinite(video.duration) ? video.duration : seconds;
    const targetSeconds = Math.max(0, Math.min(seconds, maxTime));
    video.currentTime = targetSeconds;
    setPlaybackSeconds(targetSeconds);
    setAllowFutureLead(false);
  };

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
