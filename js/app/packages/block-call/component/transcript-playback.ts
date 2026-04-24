import type { CallRecordTranscriptSegment } from '@service-storage/generated/schemas/callRecordTranscriptSegment';

export function getActiveTranscriptSequenceNum(
  transcript: CallRecordTranscriptSegment[],
  playbackSeconds: number
): number | null {
  if (transcript.length === 0 || playbackSeconds < 0) return null;

  const sorted = [...transcript].sort((a, b) => a.sequenceNum - b.sequenceNum);
  const firstStartMs = new Date(sorted[0].startedAt).getTime();
  if (!Number.isFinite(firstStartMs)) return null;

  // Bias slightly earlier so short segments feel responsive.
  const ACTIVE_LEAD_MS = 250;
  const currentTimelineMs = firstStartMs + playbackSeconds * 1000 + ACTIVE_LEAD_MS;
  if (currentTimelineMs < firstStartMs) return null;

  let activeSequenceNum: number | null = null;
  for (let i = 0; i < sorted.length; i += 1) {
    const currentStartMs = new Date(sorted[i].startedAt).getTime();
    if (!Number.isFinite(currentStartMs)) continue;

    // Use the latest segment whose start is <= playback time.
    // This handles close/identical timestamps without skipping rows.
    if (currentTimelineMs >= currentStartMs) {
      activeSequenceNum = sorted[i].sequenceNum;
    } else {
      break;
    }
  }

  return activeSequenceNum;
}

export function formatVideoTimestamp(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function getSegmentVideoSeconds(
  segment: CallRecordTranscriptSegment,
  timelineStartMs: number | null
): number | null {
  if (timelineStartMs === null) return null;
  const segmentStartMs = new Date(segment.startedAt).getTime();
  if (!Number.isFinite(segmentStartMs)) return null;
  return Math.max(0, (segmentStartMs - timelineStartMs) / 1000);
}
