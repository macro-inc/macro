import type { CallRecordTranscriptSegment } from '@service-storage/generated/schemas/callRecordTranscriptSegment';

export function sortTranscriptSegments(
  transcript: CallRecordTranscriptSegment[]
): CallRecordTranscriptSegment[] {
  return [...transcript].sort((a, b) => a.sequenceNum - b.sequenceNum);
}

export function getActiveTranscriptSequenceNum(
  sortedTranscript: CallRecordTranscriptSegment[],
  playbackSeconds: number,
  timelineStartMs: number | null,
  allowFutureLead = true
): number | null {
  if (
    sortedTranscript.length === 0 ||
    playbackSeconds < 0 ||
    timelineStartMs === null ||
    !Number.isFinite(timelineStartMs)
  )
    return null;

  // Bias slightly earlier so short segments feel responsive.
  const ACTIVE_LEAD_MS = 250;
  const rawTimelineMs = timelineStartMs + playbackSeconds * 1000;
  const currentTimelineMs = allowFutureLead
    ? rawTimelineMs + ACTIVE_LEAD_MS
    : rawTimelineMs;

  let activeSequenceNum: number | null = null;
  for (let i = 0; i < sortedTranscript.length; i += 1) {
    const currentStartMs = new Date(sortedTranscript[i].startedAt).getTime();
    if (!Number.isFinite(currentStartMs)) continue;

    // Use the latest segment whose start is <= playback time.
    // This handles close/identical timestamps without skipping rows.
    if (
      currentTimelineMs >= currentStartMs &&
      rawTimelineMs >= currentStartMs
    ) {
      activeSequenceNum = sortedTranscript[i].sequenceNum;
    } else {
      break;
    }
  }

  return activeSequenceNum;
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
