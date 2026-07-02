import { blur, max } from 'd3-array';
import { area, curveBasis } from 'd3-shape';

export const SESSION_GAP_MS = 10 * 60 * 1000;
const GAP_COMPRESSION_MULTIPLIER = 0.25;
export const ACTIVE_TIME_MULTIPLIER = 8;

export type Interval = { startMs: number; endMs: number; warpStart: number };

// where it's supposed to look like it's starting, plus the real duration
// we only fake the start position
export const warpedIntervalEnd = (iv: Interval) =>
  iv.warpStart + (iv.endMs - iv.startMs) * ACTIVE_TIME_MULTIPLIER;

export type CompressedTimeline = { intervals: Interval[]; total: number };

// Merges overlapping/adjacent sessions into contiguous blocks, then assigns
// each block a warped start offset where gaps are logarithmically compressed.
// Dead time between sessions takes up far less space than real editing time.
// The idea is that we find all the overlapping sections where at least one person is editing, then find the gap between each of the merged sections, and assign real start, real end, and how much "virtual padding" to add after each section.
export function buildCompressedTimeline(
  sessions: readonly { startMs: number; endMs: number }[],
  gapMs: number = SESSION_GAP_MS
): CompressedTimeline {
  if (sessions.length === 0) return { intervals: [], total: 0 };

  const spans = [...sessions].sort((a, b) => a.startMs - b.startMs);
  const merged: { startMs: number; endMs: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.startMs - last.endMs <= gapMs) {
      last.endMs = Math.max(last.endMs, span.endMs);
    } else {
      merged.push({ ...span });
    }
  }

  const intervals: Interval[] = [];
  let offset = 0;
  for (let i = 0; i < merged.length; i++) {
    if (i > 0) {
      const gap = merged[i].startMs - merged[i - 1].endMs;
      offset +=
        gapMs *
        GAP_COMPRESSION_MULTIPLIER *
        (1 + Math.log(1 + (gap - gapMs) / gapMs));
    }
    const span = merged[i];
    const endMs = Math.max(span.endMs, span.startMs + 1);
    intervals.push({ startMs: span.startMs, endMs, warpStart: offset });
    offset += (endMs - span.startMs) * ACTIVE_TIME_MULTIPLIER;
  }

  return { intervals, total: offset };
}

export type VolumeShape = { area: string; line: string };

// Height in pixels of the volume band SVG. Exported so the caller can size the viewBox to match.
export const VOLUME_BAND_H = 32;

const VOLUME_BUCKETS = 160;

// Histogram of edit intensity across the timeline. Each session contributes
// edits/minute to the buckets it spans (in pixel space), normalized to the
// peak so the shape is always full-height regardless of absolute volume.
export function buildVolumeShape(
  sessions: readonly { startMs: number; endMs: number; count: number }[],
  toXPosition: (ms: number) => number,
  width: number,
  bandH: number = VOLUME_BAND_H
): VolumeShape | null {
  if (width <= 0 || sessions.length === 0) return null;

  const bucketWidth = width / VOLUME_BUCKETS;
  const buckets = new Array<number>(VOLUME_BUCKETS).fill(0);

  for (const session of sessions) {
    // Rate in edits/min; floor duration at 1 min so short bursts don't spike to infinity.
    const durMin = Math.max(1, (session.endMs - session.startMs) / 60_000);
    const rate = session.count / durMin;
    const leftPx = Math.max(0, toXPosition(session.startMs));
    const rightPx = Math.min(width, toXPosition(session.endMs));
    if (rightPx < 0 || leftPx > width || rightPx < leftPx) continue;
    const clampBucket = (px: number) =>
      Math.max(0, Math.min(VOLUME_BUCKETS - 1, Math.floor(px / bucketWidth)));
    const firstBucket = clampBucket(leftPx);
    // Subtract epsilon so a session ending exactly on a bucket boundary doesn't bleed into the next.
    const lastBucket = Math.max(firstBucket, clampBucket(rightPx - 1e-6));
    for (let i = firstBucket; i <= lastBucket; i++) buckets[i] += rate;
  }

  // More sessions in view -> lower blur radius.
  // this lets us see more detail when the detail has meaning. if we show deep
  // detail (low smoothing) when there are just a few sessions then we will just
  // see spikes for those specific sessions, which isn't super useful.
  const visibleCount = sessions.filter(s => {
    const leftPos = toXPosition(s.startMs);
    const rightPos = toXPosition(s.endMs);
    // "is it in view at all?"
    return rightPos >= 0 && leftPos <= width;
  }).length;

  // the actual amount of blur radius proportional to the number of visible
  // sessions is log-based.
  const blurRadius = Math.max(1, Math.floor(8 / Math.log2(2 + visibleCount)));
  const roundedBuckets = Array.from(blur([...buckets], blurRadius));
  const peak = max(roundedBuckets) ?? 0;
  if (peak <= 0) return null;

  // y1 leaves 2px headroom at the top so the line is always visible at peak.
  const areaGenerator = area<number>()
    .x((_, i) => (i / (VOLUME_BUCKETS - 1)) * width)
    .y0(bandH)
    .y1((value) => bandH - (value / peak) * (bandH - 2))
    .curve(curveBasis);

  return {
    area: areaGenerator(roundedBuckets) ?? '',
    line: areaGenerator.lineY1()(roundedBuckets) ?? '',
  };
}
