import { type ScaleLinear, scaleLinear } from 'd3-scale';
import { createMemo } from 'solid-js';
import {
  buildCompressedTimeline,
  type CompressedTimeline,
  warpedIntervalEnd,
} from './timeline';
import { humanizeDuration } from './utils';

export type WindowRange = { start: number; end: number };
export type GapMarker = { left: number; width: number; label: string };

// How many activity blocks to show by default before the user pans/zooms.
const DEFAULT_SESSIONS = 6;

// Custom hook that owns all the coordinate math for the timeline scrubber.
// Accepts reactive inputs and returns stable function references backed by memos.
//
// Coordinate pipeline:
//   real timestamp (ms)
//     -> warped position  [warpScale: compresses gap dead time logarithmically]
//     -> container position  [containerXScale: maps the visible window onto [0, width]]
export function createTimelineScales(
  sessions: () => readonly { startMs: number; endMs: number }[],
  width: () => number,
  view: () => WindowRange | null,
  gapMarkerMinPx = 36
) {
  const compressedTimeline = createMemo<CompressedTimeline>(() =>
    buildCompressedTimeline(sessions())
  );

  // Maps real timestamps to warped coordinates. We feed d3 the start and end of
  // each activity block as alternating domain/range pairs, d3 handles the rest
  // by interpolating linearly within each block (given a real timestamp, it
  // will put it into this new scale at a corresponding position). The gaps
  // between blocks simply don't appear in the domain, so they get compressed
  // away. .clamp(true) snaps any timestamp that falls in a gap to the nearest
  // block edge.
  const warpScale = createMemo<ScaleLinear<number, number>>(() => {
    const { intervals } = compressedTimeline();
    if (intervals.length === 0)
      return scaleLinear().domain([0, 1]).range([0, 0]);
    return scaleLinear()
      .domain(
        intervals.flatMap((interval) => [interval.startMs, interval.endMs])
      )
      .range(
        intervals.flatMap((interval) => [
          interval.warpStart,
          warpedIntervalEnd(interval),
        ])
      )
      .clamp(true);
  });

  const timestampToWarpedPosition = (ms: number): number => warpScale()(ms);
  const warpedPositionToTimestamp = (warped: number): number => {
    const ms = warpScale().invert(warped);
    return Number.isNaN(ms) ? 0 : ms;
  };

  // The default visible window before the user pans or zooms. Shows everything
  // if there are few enough activity blocks; otherwise shows only the most
  // recent DEFAULT_SESSIONS blocks by starting the window at the 6th-from-last.
  const defaultWindow = createMemo<WindowRange>(() => {
    const { intervals, total } = compressedTimeline();
    if (intervals.length <= DEFAULT_SESSIONS)
      return { start: 0, end: Math.max(1, total) };
    return {
      start: intervals[intervals.length - DEFAULT_SESSIONS].warpStart,
      end: total,
    };
  });

  const visibleWindow = createMemo<WindowRange>(
    () => view() ?? defaultWindow()
  );

  const containerXScale = createMemo<ScaleLinear<number, number>>(() =>
    scaleLinear()
      .domain([visibleWindow().start, visibleWindow().end])
      .range([0, Math.max(1, width())])
  );

  const warpedPositionToContainerPosition = (warped: number) =>
    containerXScale()(warped);
  const containerPositionToWarpedPosition = (px: number) =>
    containerXScale().invert(px);

  // Full pipeline: timestamp → warped position → container position.
  const timestampToContainerPosition = (ms: number) =>
    warpedPositionToContainerPosition(timestampToWarpedPosition(ms));
  // Full pipeline: container position → warped position → timestamp.
  const containerPositionToTimestamp = (px: number) =>
    warpedPositionToTimestamp(containerPositionToWarpedPosition(px));

  const gapMarkers = createMemo<GapMarker[]>(() => {
    const totalWidth = width();
    const { intervals } = compressedTimeline();
    const out: GapMarker[] = [];
    for (let i = 1; i < intervals.length; i++) {
      const prev = intervals[i - 1];
      const cur = intervals[i];
      const left = warpedPositionToContainerPosition(warpedIntervalEnd(prev));
      const right = warpedPositionToContainerPosition(cur.warpStart);
      if (right < 0 || left > totalWidth) continue;
      const markerWidth = right - left;
      if (markerWidth < gapMarkerMinPx) continue;
      out.push({
        left,
        width: markerWidth,
        label: humanizeDuration(cur.startMs - prev.endMs),
      });
    }
    return out;
  });

  return {
    /** Merged + warped session intervals. Source of truth for all coordinate math. */
    compressedTimeline,
    /** The slice of the timeline currently on screen, in warped coordinates. Defaults to
     *  the last DEFAULT_SESSIONS blocks; updated when the user pans or zooms. */
    visibleWindow,
    /** Gap labels between activity blocks, pre-filtered to those wide enough to display. */
    gapMarkers,
    /** Warped position → real timestamp (ms). Inverse of the warp compression. */
    warpedPositionToTimestamp,
    /** Warped position → screen pixel within the container. */
    warpedPositionToContainerPosition,
    /** Screen pixel → warped position. */
    containerPositionToWarpedPosition,
    /** Real timestamp (ms) → screen pixel. Full two-step pipeline. */
    timestampToContainerPosition,
    /** Screen pixel → real timestamp (ms). Full two-step pipeline. */
    containerPositionToTimestamp,
  };
}
