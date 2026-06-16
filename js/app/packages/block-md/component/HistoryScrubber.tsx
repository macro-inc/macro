import { macroIdToEmail, tryMacroId } from '@core/user';
import type { HistorySession } from '@service-sync/client';
import { makeResizeObserver } from '@solid-primitives/resize-observer';
import { group, max } from 'd3-array';
import { scaleLinear } from 'd3-scale';
import { area, curveBasis } from 'd3-shape';
import { createMemo, createSignal, For, onMount, Show } from 'solid-js';

/**
 * History scrubber on a warped time axis: active editing stretches keep real
 * time scale while idle gaps collapse. One lane per user below the rail shows
 * that user's sessions. Drag on the rail to zoom into a region, scroll to pan,
 * double-click to reset; click to seek, drag the diamond to scrub.
 */
type ScrubberUser = { id: string; label: string; color: string };

const SESSION_GAP_MS = 5 * 60 * 1000;
const LANE_HUES = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
// Smallest warped zoom window (≈1s of active time).
const MIN_VIEW = 1000;
// Pointer travel (px) above which a press is a zoom-drag, not a click.
const DRAG_THRESHOLD = 4;
// Px radius around the diamond within which pointer-down starts a scrub-drag.
const THUMB_HIT_PX = 12;
// On open, focus the most recent this-many active sessions.
const DEFAULT_SESSIONS = 6;
// Minimum on-screen gap width (px) to show the ·· Xd ·· break marker.
const GAP_MARKER_MIN_PX = 36;
// Background activity meter: number of buckets across the rail width and the
// band height (px) the smoothed curve is drawn into.
const VOLUME_BUCKETS = 80;
const VOLUME_BAND_H = 32;

/** Deterministic per-user color from the live-collab accent palette. */
function userColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return `var(--color-accent-${LANE_HUES[Math.abs(hash) % LANE_HUES.length]})`;
}

function userLabel(userId: string): string {
  if (userId === 'unknown') return 'Unknown';
  const id = tryMacroId(userId);
  return id ? macroIdToEmail(id) : userId;
}

function humanizeDuration(ms: number): string {
  const d = ms / 86_400_000;
  if (d >= 1) return `${Math.round(d)}d`;
  const h = ms / 3_600_000;
  if (h >= 1) return `${Math.round(h)}h`;
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}

// The warped axis: active editing intervals keep real-time scale, while the idle
// gaps between them collapse. Intervals are laid out left-to-right by their
// `warpStart` offset; a gap is just the space between consecutive intervals.
type Interval = { startMs: number; endMs: number; warpStart: number };

/** Where an interval ends on the warped axis. */
const intervalWarpEnd = (iv: Interval) =>
  iv.warpStart + (iv.endMs - iv.startMs);

export function HistoryScrubber(props: {
  sessions: readonly HistorySession[];
  onSelect: (at: Date | null) => void;
}) {
  let containerRef!: HTMLDivElement;
  const [width, setWidth] = createSignal(0);
  // Explicitly placed cursor in wall-clock ms; null = show latest (right edge).
  const [cursorMs, setCursorMs] = createSignal<number | null>(null);
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
  // Explicit zoom window in warped units; null = default (last N sessions).
  const [view, setView] = createSignal<{ start: number; end: number } | null>(
    null
  );

  type Drag =
    | { mode: 'scrub' }
    | { mode: 'marquee'; startPx: number; curPx: number };
  const [drag, setDrag] = createSignal<Drag | null>(null);

  // Pointer x while hovering (no drag active) — drives the preview line.
  const [hoverPx, setHoverPx] = createSignal<number | null>(null);

  const users = createMemo<ScrubberUser[]>(() => {
    const ids = [...new Set(props.sessions.map((s) => s.userId))];
    return ids.map((id) => ({
      id,
      label: userLabel(id),
      color: userColor(id),
    }));
  });

  const toggleUser = (id: string) => {
    const next = new Set(hidden());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
  };

  const lanes = createMemo(() => {
    const visible = props.sessions.filter((s) => !hidden().has(s.userId));
    const byUser = group(visible, (s) => s.userId);
    return users()
      .filter((u) => byUser.has(u.id))
      .map((u) => ({ user: u, sessions: byUser.get(u.id)! }));
  });

  onMount(() => {
    const { observe } = makeResizeObserver(() =>
      setWidth(containerRef.getBoundingClientRect().width)
    );
    observe(containerRef);
    setWidth(containerRef.getBoundingClientRect().width);
  });

  // Active editing intervals keep real-time scale; idle gaps are log-compressed.
  const warp = createMemo(() => {
    if (props.sessions.length === 0) {
      return { intervals: [] as Interval[], total: 1 };
    }

    // Merge overlapping/adjacent sessions into contiguous active intervals.
    const spans = props.sessions
      .map((s) => ({ startMs: s.startMs, endMs: s.endMs }))
      .sort((a, b) => a.startMs - b.startMs);
    const merged: { startMs: number; endMs: number }[] = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && s.startMs - last.endMs <= SESSION_GAP_MS) {
        last.endMs = Math.max(last.endMs, s.endMs);
      } else {
        merged.push({ ...s });
      }
    }

    const intervals: Interval[] = [];
    let offset = 0;
    for (let i = 0; i < merged.length; i++) {
      if (i > 0) {
        // Collapse the idle gap before this interval (always > SESSION_GAP_MS):
        // the log term squashes long gaps so a day idle doesn't dwarf the editing.
        const gapMs = merged[i].startMs - merged[i - 1].endMs;
        offset +=
          SESSION_GAP_MS *
          (1 + Math.log(1 + (gapMs - SESSION_GAP_MS) / SESSION_GAP_MS));
      }
      const span = merged[i];
      // Floor to ≥1ms wide so the polylinear scale's domain stays strictly
      // increasing (its `.invert()` requires it); 1ms is invisible on this axis.
      const endMs = Math.max(span.endMs, span.startMs + 1);
      intervals.push({ startMs: span.startMs, endMs, warpStart: offset });
      offset += endMs - span.startMs;
    }

    return { intervals, total: offset || 1 };
  });

  // The warped axis as a polylinear scale: each interval contributes a
  // [startMs, endMs] → [warpStart, warpEnd] segment, and the collapsed idle gaps
  // fall out as the linear segments between them. Clamped, so out-of-range times
  // pin to the ends; `.invert()` is the warped → wall-clock direction.
  const warpScale = createMemo(() => {
    const { intervals } = warp();
    if (intervals.length === 0)
      return scaleLinear().domain([0, 1]).range([0, 0]);
    return scaleLinear()
      .domain(intervals.flatMap((iv) => [iv.startMs, iv.endMs]))
      .range(intervals.flatMap((iv) => [iv.warpStart, intervalWarpEnd(iv)]))
      .clamp(true);
  });

  /** Wall-clock ms → warped coordinate. */
  const warpMs = (ms: number): number => warpScale()(ms);

  /** Warped coordinate → wall-clock ms. */
  const unwarp = (warped: number): number => {
    const ms = warpScale().invert(warped);
    return Number.isNaN(ms) ? 0 : ms;
  };

  // Default: show the last N sessions; user can zoom/pan away from this.
  const defaultWindow = createMemo(() => {
    const { intervals, total } = warp();
    if (intervals.length <= DEFAULT_SESSIONS) return { start: 0, end: total };
    return {
      start: intervals[intervals.length - DEFAULT_SESSIONS].warpStart,
      end: total,
    };
  });

  const viewW = createMemo(() => view() ?? defaultWindow());

  // Maps the visible warped window to pixels (and back via `.invert`).
  const xScale = createMemo(() =>
    scaleLinear()
      .domain([viewW().start, viewW().end])
      .range([0, Math.max(1, width())])
  );
  const toPx = (warped: number) => xScale()(warped);
  const fromPx = (px: number) => xScale().invert(px);

  const clampView = (start: number, end: number) => {
    const total = warp().total;
    const span = Math.min(Math.max(MIN_VIEW, end - start), total);
    let s = Math.max(0, start);
    if (s + span > total) s = total - span;
    if (s < 0) s = 0;
    return { start: s, end: s + span };
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const { start, end } = viewW();
    const delta =
      Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (delta === 0) return;
    const shift = (delta / Math.max(1, width())) * (end - start);
    setView(clampView(start + shift, end + shift));
  };

  const localPx = (clientX: number) => {
    const rect = containerRef.getBoundingClientRect();
    return Math.min(Math.max(0, clientX - rect.left), rect.width);
  };

  const pxToMs = (px: number) => unwarp(fromPx(px));

  const placeAt = (px: number) => {
    const ms = pxToMs(px);
    setCursorMs(ms);
    props.onSelect(new Date(ms));
  };

  const thumbPx = createMemo<number | null>(() => {
    const c = cursorMs();
    const w = width();
    // Default to right edge (latest state) when no cursor is explicitly placed.
    const px = c === null ? w : toPx(warpMs(c));
    return px < -0.5 || px > w + 0.5 ? null : px;
  });

  const onPointerDown = (e: PointerEvent) => {
    setHoverPx(null);
    const px = localPx(e.clientX);
    const tp = thumbPx();
    // Grab the diamond if the pointer is close enough; otherwise start a zoom marquee.
    if (tp !== null && Math.abs(px - tp) <= THUMB_HIT_PX) {
      setDrag({ mode: 'scrub' });
    } else {
      setDrag({ mode: 'marquee', startPx: px, curPx: px });
    }
    containerRef.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    const px = localPx(e.clientX);
    const d = drag();
    if (!d) {
      setHoverPx(px);
      return;
    }
    if (d.mode === 'scrub') {
      // Move the thumb visually while dragging; request fires on release.
      setCursorMs(pxToMs(px));
    } else {
      setDrag({ mode: 'marquee', startPx: d.startPx, curPx: px });
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = drag();
    if (!d) return;
    setDrag(null);
    if (warp().intervals.length === 0) return;
    const px = localPx(e.clientX);
    if (d.mode === 'scrub') {
      placeAt(px);
      return;
    }
    if (Math.abs(d.curPx - d.startPx) > DRAG_THRESHOLD) {
      // Drag → zoom into the selected region.
      const a = fromPx(Math.min(d.startPx, d.curPx));
      const b = fromPx(Math.max(d.startPx, d.curPx));
      setView(clampView(a, b));
    } else {
      // Click → place cursor at that position.
      placeAt(px);
    }
  };

  const cursorStyle = createMemo(() => {
    const d = drag();
    if (d?.mode === 'scrub') return 'grabbing';
    const tp = thumbPx();
    const hp = hoverPx();
    if (tp !== null && hp !== null && Math.abs(hp - tp) <= THUMB_HIT_PX)
      return 'grab';
    return 'crosshair';
  });

  // In-progress zoom selection rectangle (marquee only, past the threshold).
  const marquee = createMemo(() => {
    const d = drag();
    return d?.mode === 'marquee' &&
      Math.abs(d.curPx - d.startPx) > DRAG_THRESHOLD
      ? d
      : null;
  });

  // Collapsed idle-gap break markers — only when wide enough to read.
  const gapMarkers = createMemo(() => {
    const w = width();
    const { intervals } = warp();
    const out: { left: number; width: number; label: string }[] = [];
    // A gap is the space between one interval's end and the next one's start.
    for (let i = 1; i < intervals.length; i++) {
      const prev = intervals[i - 1];
      const cur = intervals[i];
      const left = toPx(intervalWarpEnd(prev));
      const right = toPx(cur.warpStart);
      if (right < 0 || left > w) continue;
      const markerWidth = right - left;
      if (markerWidth < GAP_MARKER_MIN_PX) continue;
      out.push({
        left,
        width: markerWidth,
        label: humanizeDuration(cur.startMs - prev.endMs),
      });
    }
    return out;
  });

  // We have a cool "volume meter" in the background. This is sort of best effort
  // and is just based on the number of edts
  const volume = createMemo(() => {
    const w = width();
    if (w <= 0 || props.sessions.length === 0) return null;
    const bucketCount = VOLUME_BUCKETS;
    const bucketWidth = w / bucketCount;
    const buckets = new Array<number>(bucketCount).fill(0);
    for (const s of props.sessions) {
      // for each session, assume an even edit rate (just a heuristic)
      const durMin = Math.max(1, (s.endMs - s.startMs) / 60_000);
      const rate = s.count / durMin; // avg edits per minute

      const leftPx = Math.max(0, toPx(warpMs(s.startMs)));
      const rightPx = Math.min(w, toPx(warpMs(s.endMs)));
      if (rightPx < 0 || leftPx > w || rightPx < leftPx) continue;
      const clampBucket = (px: number) =>
        Math.max(0, Math.min(bucketCount - 1, Math.floor(px / bucketWidth)));
      const firstBucket = clampBucket(leftPx);
      const lastBucket = Math.max(firstBucket, clampBucket(rightPx - 1e-6));
      for (let i = firstBucket; i <= lastBucket; i++) buckets[i] += rate;
    }
    const peak = max(buckets) ?? 0;
    if (peak <= 0) return null;
    const H = VOLUME_BAND_H;
    // curveBasis smooths the curve itself; the area generator gives both the
    // filled shape and (via lineY1) its top edge, anchored across the width.
    const areaGenerator = area<number>()
      .x((_, i) => (i / (bucketCount - 1)) * w)
      .y0(H)
      .y1((v) => H - (v / peak) * (H - 2))
      .curve(curveBasis);
    return {
      area: areaGenerator(buckets) ?? '',
      line: areaGenerator.lineY1()(buckets) ?? '',
    };
  });

  const fmt = (at: Date) =>
    at.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  return (
    <div class="flex flex-1 items-start gap-4">
      <div
        ref={containerRef}
        class="relative isolate mx-6 mb-4 min-w-0 flex-1 touch-none select-none"
        style={{ cursor: cursorStyle() }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHoverPx(null)}
        onWheel={onWheel}
        onDblClick={() => setView({ start: 0, end: warp().total })}
      >
        {/* Background activity meter — smoothed edit volume over time, stretched
            behind the whole scrubber (rail + lanes) as an ambient backdrop. */}
        <Show when={volume()}>
          {(v) => (
            <svg
              class="pointer-events-none absolute inset-0 -z-10 size-full text-ink-muted"
              preserveAspectRatio="none"
              viewBox={`0 0 ${width()} ${VOLUME_BAND_H}`}
              aria-hidden="true"
            >
              <path d={v().area} fill="currentColor" class="opacity-[0.08]" />
              <path
                d={v().line}
                fill="none"
                stroke="currentColor"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
                class="opacity-25"
              />
            </svg>
          )}
        </Show>

        {/* Full-height hover preview line — shows where a click would land */}
        <Show when={hoverPx() !== null && drag() === null}>
          <div
            class="pointer-events-none absolute inset-y-0 z-10 w-px bg-accent/30"
            style={{ left: `${hoverPx() ?? 0}px` }}
          />
        </Show>

        {/* Rail */}
        <div class="relative h-8 overflow-hidden">
          <div class="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-edge" />
          <For each={gapMarkers()}>
            {(g) => (
              <div
                class="absolute inset-y-0 flex items-center justify-center overflow-hidden whitespace-nowrap text-xxs text-ink-muted"
                style={{ left: `${g.left}px`, width: `${g.width}px` }}
              >
                {`·· ${g.label} ··`}
              </div>
            )}
          </For>
          {/* Zoom marquee selection rectangle (this is the click, drag, let go to zoom in / out functionality ) */}
          <Show when={marquee()}>
            {(m) => (
              <div
                class="absolute inset-y-0 z-10 border-accent border-x bg-accent/20"
                style={{
                  left: `${Math.min(m().startPx, m().curPx)}px`,
                  width: `${Math.abs(m().curPx - m().startPx)}px`,
                }}
              />
            )}
          </Show>
          {/* Diamond thumb — position indicator, grab to scrub */}
          <Show when={thumbPx() !== null}>
            <div
              class="pointer-events-none absolute top-1/2 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
              style={{ left: `${thumbPx()!}px` }}
            >
              <div class="size-2.5 rotate-45 bg-accent shadow" />
            </div>
          </Show>
        </div>

        {/* Per-user session lanes */}
        <div class="flex flex-col gap-0.5">
          <For each={lanes()}>
            {(lane) => (
              <div class="relative h-2 overflow-hidden rounded-full">
                <div class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-edge/60" />
                <For each={lane.sessions}>
                  {(s) => {
                    const left = () => toPx(warpMs(s.startMs));
                    const right = () => toPx(warpMs(s.endMs));
                    return (
                      <div
                        class="absolute inset-y-0 rounded-full"
                        title={lane.user.label}
                        style={{
                          left: `${left()}px`,
                          width: `${Math.max(3, right() - left())}px`,
                          background: lane.user.color,
                        }}
                      />
                    );
                  }}
                </For>
              </div>
            )}
          </For>
        </div>

        {/* Diagonal edge labels showing the visible window's real-time bounds */}
        <span class="absolute top-full left-0 origin-top-left -rotate-12 text-xxs text-ink-muted">
          {fmt(new Date(unwarp(viewW().start)))}
        </span>
        <span class="absolute top-full right-0 origin-top-right rotate-12 text-xxs text-ink-muted">
          {fmt(new Date(unwarp(viewW().end)))}
        </span>
      </div>

      {/* Legend — click to toggle a user's lane */}
      <Show when={users().length > 0}>
        <div class="flex max-h-32 shrink-0 flex-col gap-0.5 overflow-y-auto overscroll-contain pr-1 text-xs">
          <For each={users()}>
            {(u) => (
              <button
                type="button"
                class="flex items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-hover"
                classList={{ 'opacity-40': hidden().has(u.id) }}
                onClick={() => toggleUser(u.id)}
              >
                <span
                  class="size-2 shrink-0 rounded-full"
                  style={{ background: u.color }}
                />
                <span class="max-w-40 truncate">{u.label}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
