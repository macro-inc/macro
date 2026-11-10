import type { CallRecord } from '@service-call/client';
import { type Accessor, createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  seekDedupeKey,
  shouldCoalesceSeekGenerationBump,
} from '../component/CallRecording/call-recording-utils';
import {
  getActiveTranscriptSequenceNum,
  getSegmentVideoSeconds,
  sortTranscriptSegments,
} from '../component/transcript-playback';

type RecordingTimelineState = {
  playbackSeconds: number;
  allowFutureLead: boolean;
  videoSeekGeneration: number;
};

/** Coordinate media events, transcript seeks and the active transcript segment. */
export function createRecordingTimeline(
  record: Accessor<CallRecord>,
  videoRef: Accessor<HTMLVideoElement | undefined>
) {
  const [state, setState] = createStore<RecordingTimelineState>({
    playbackSeconds: 0,
    allowFutureLead: true,
    videoSeekGeneration: 0,
  });
  const sortedTranscript = createMemo(() =>
    sortTranscriptSegments(record().transcript)
  );

  let lastVideoSeekBumpKey: string | null = null;
  let lastVideoSeekBumpAtMs = 0;

  const timelineStartMs = createMemo(() => {
    const anchor = record().recordingStartedAt ?? record().startedAt;
    const ms = new Date(anchor).getTime();
    return Number.isFinite(ms) ? ms : null;
  });
  // A programmatic seek and its seeked event share one generation within 45ms.
  // Only seeks bump the generation used to restart transcript following.
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
    setState('videoSeekGeneration', (n) => n + 1);
  };

  const activeSequenceNum = createMemo(() =>
    getActiveTranscriptSequenceNum(
      sortedTranscript(),
      state.playbackSeconds,
      timelineStartMs(),
      state.allowFutureLead
    )
  );

  const handleTimeUpdate = (
    seconds: number,
    source: 'playback' | 'seeking' | 'seeked'
  ) => {
    setState({
      playbackSeconds: seconds,
      allowFutureLead: source === 'playback',
    });
    if (source === 'seeked') bumpVideoSeekGeneration(seconds);
  };

  const seekToSeconds = (seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    const video = videoRef();
    let maxTime = seconds;
    if (video && Number.isFinite(video.duration)) {
      maxTime = video.duration;
    }
    const targetSeconds = Math.max(0, Math.min(seconds, maxTime));

    setState({ playbackSeconds: targetSeconds, allowFutureLead: false });
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
  return {
    timelineStartMs,
    activeSequenceNum,
    handleTimeUpdate,
    seekToSeconds,
    goToTranscriptSegment,
    sortedTranscript,
    videoSeekGeneration: () => state.videoSeekGeneration,
  };
}
