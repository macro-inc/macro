import type { HistorySession, VersionPin } from '@service-sync/client';
import { makeResizeObserver } from '@solid-primitives/resize-observer';
import { group, max } from 'd3-array';
import { scaleLinear } from 'd3-scale';
import { area, curveBasis } from 'd3-shape';
import {
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from 'solid-js';
import { CreatePin } from './CreatePin';
import {
  humanizeDuration,
  intervalWarpEnd,
  type Interval,
  LANE_HUES,
  SESSION_GAP_MS,
  userColor,
  userLabel,
} from './utils';

/**
 * History scrubber on a warped time axis: active editing stretches keep real
 * time scale while idle gaps collapse. One lane per user below the rail shows
 * that user's sessions. Click to create a pin; click+drag to scrub; scroll to
 * pan; double-click to reset zoom.
 */
type ScrubberUser = { id: string; label: string; color: string };

const MIN_VIEW = 1000;
const DRAG_THRESHOLD = 4;
const THUMB_HIT_PX = 12;
const DEFAULT_SESSIONS = 6;
const GAP_MARKER_MIN_PX = 36;
const VOLUME_BUCKETS = 80;
const VOLUME_BAND_H = 32;
const RAIL_HEIGHT_PX = 32; // h-8

export function HistoryScrubber(props: {
  sessions: readonly HistorySession[];
  pins: readonly VersionPin[];
  onSelect: (at: Date | null) => void;
  onCreatePin: (atMs: number, label: string) => void;
  onDeletePin: (pinId: string) => void;
}) {
  let containerRef!: HTMLDivElement;
  const [width, setWidth] = createSignal(0);
  const [cursorMs, setCursorMs] = createSignal<number | null>(null);
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
  const [view, setView] = createSignal<{ start: number; end: number } | null>(null);

  type Drag =
    | { mode: 'scrub'; startPx: number }
    | { mode: 'marquee'; startPx: number; curPx: number; inLanes: boolean };
  const [drag, setDrag] = createSignal<Drag | null>(null);

  const [hoverPx, setHoverPx] = createSignal<number | null>(null);
  const [createPinAt, setCreatePinAt] = createSignal<{
    leftPx: number;
    atMs: number;
  } | null>(null);

  const users = createMemo<ScrubberUser[]>(() => {
    const ids = [...new Set(props.sessions.map((s) => s.userId))];
    return ids.map((id) => ({ id, label: userLabel(id), color: userColor(id) }));
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

  const warp = createMemo(() => {
    if (props.sessions.length === 0) {
      return { intervals: [] as Interval[], total: 1 };
    }

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
        const gapMs = merged[i].startMs - merged[i - 1].endMs;
        offset +=
          SESSION_GAP_MS *
          (1 + Math.log(1 + (gapMs - SESSION_GAP_MS) / SESSION_GAP_MS));
      }
      const span = merged[i];
      const endMs = Math.max(span.endMs, span.startMs + 1);
      intervals.push({ startMs: span.startMs, endMs, warpStart: offset });
      offset += endMs - span.startMs;
    }

    return { intervals, total: offset || 1 };
  });

  const warpScale = createMemo(() => {
    const { intervals } = warp();
    if (intervals.length === 0) return scaleLinear().domain([0, 1]).range([0, 0]);
    return scaleLinear()
      .domain(intervals.flatMap((iv) => [iv.startMs, iv.endMs]))
      .range(intervals.flatMap((iv) => [iv.warpStart, intervalWarpEnd(iv)]))
      .clamp(true);
  });

  const warpMs = (ms: number): number => warpScale()(ms);
  const unwarp = (warped: number): number => {
    const ms = warpScale().invert(warped);
    return Number.isNaN(ms) ? 0 : ms;
  };

  const defaultWindow = createMemo(() => {
    const { intervals, total } = warp();
    if (intervals.length <= DEFAULT_SESSIONS) return { start: 0, end: total };
    return {
      start: intervals[intervals.length - DEFAULT_SESSIONS].warpStart,
      end: total,
    };
  });

  const viewW = createMemo(() => view() ?? defaultWindow());

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

  const localY = (clientY: number) => {
    return clientY - containerRef.getBoundingClientRect().top;
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
    const px = c === null ? w : toPx(warpMs(c));
    return px < -0.5 || px > w + 0.5 ? null : px;
  });

  let lastClickMs = 0;

  const onPointerDown = (e: PointerEvent) => {
    if (createPinAt()) { setCreatePinAt(null); return; }
    setHoverPx(null);
    const px = localPx(e.clientX);
    const tp = thumbPx();
    if (tp !== null && Math.abs(px - tp) <= THUMB_HIT_PX) {
      setDrag({ mode: 'scrub', startPx: px });
    } else {
      const inLanes = localY(e.clientY) > RAIL_HEIGHT_PX;
      setDrag({ mode: 'marquee', startPx: px, curPx: px, inLanes });
    }
    containerRef.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    const px = localPx(e.clientX);
    const d = drag();
    if (!d) { setHoverPx(px); return; }
    if (d.mode === 'scrub') {
      setCursorMs(pxToMs(px));
    } else {
      setDrag({ ...d, curPx: px });
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
      const a = fromPx(Math.min(d.startPx, d.curPx));
      const b = fromPx(Math.max(d.startPx, d.curPx));
      setView(clampView(a, b));
    } else if (!d.inLanes) {
      const now = Date.now();
      const isDouble = now - lastClickMs < 300;
      lastClickMs = now;
      if (!isDouble) setCreatePinAt({ leftPx: px, atMs: pxToMs(px) });
    }
  };

  const marquee = createMemo(() => {
    const d = drag();
    return d?.mode === 'marquee' && Math.abs(d.curPx - d.startPx) > DRAG_THRESHOLD
      ? d
      : null;
  });

  const gapMarkers = createMemo(() => {
    const w = width();
    const { intervals } = warp();
    const out: { left: number; width: number; label: string }[] = [];
    for (let i = 1; i < intervals.length; i++) {
      const prev = intervals[i - 1];
      const cur = intervals[i];
      const left = toPx(intervalWarpEnd(prev));
      const right = toPx(cur.warpStart);
      if (right < 0 || left > w) continue;
      const markerWidth = right - left;
      if (markerWidth < GAP_MARKER_MIN_PX) continue;
      out.push({ left, width: markerWidth, label: humanizeDuration(cur.startMs - prev.endMs) });
    }
    return out;
  });

  const volume = createMemo(() => {
    const w = width();
    if (w <= 0 || props.sessions.length === 0) return null;
    const bucketWidth = w / VOLUME_BUCKETS;
    const buckets = new Array<number>(VOLUME_BUCKETS).fill(0);
    for (const s of props.sessions) {
      const durMin = Math.max(1, (s.endMs - s.startMs) / 60_000);
      const rate = s.count / durMin;
      const leftPx = Math.max(0, toPx(warpMs(s.startMs)));
      const rightPx = Math.min(w, toPx(warpMs(s.endMs)));
      if (rightPx < 0 || leftPx > w || rightPx < leftPx) continue;
      const clampBucket = (px: number) =>
        Math.max(0, Math.min(VOLUME_BUCKETS - 1, Math.floor(px / bucketWidth)));
      const firstBucket = clampBucket(leftPx);
      const lastBucket = Math.max(firstBucket, clampBucket(rightPx - 1e-6));
      for (let i = firstBucket; i <= lastBucket; i++) buckets[i] += rate;
    }
    const peak = max(buckets) ?? 0;
    if (peak <= 0) return null;
    const H = VOLUME_BAND_H;
    const areaGenerator = area<number>()
      .x((_, i) => (i / (VOLUME_BUCKETS - 1)) * w)
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
        style={{
          cursor: drag()?.mode === 'scrub'
            ? 'grabbing'
            : thumbPx() !== null &&
                hoverPx() !== null &&
                Math.abs(hoverPx()! - thumbPx()!) <= THUMB_HIT_PX
              ? 'grab'
              : 'crosshair',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHoverPx(null)}
        onWheel={onWheel}
        onDblClick={() => setView({ start: 0, end: warp().total })}
      >
        {/* Background activity meter */}
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

        {/* Hover preview line */}
        <Show when={hoverPx() !== null && drag() === null && createPinAt() === null}>
          <div
            class="pointer-events-none absolute inset-y-0 z-10 w-px bg-accent/30"
            style={{ left: `${hoverPx() ?? 0}px` }}
          />
        </Show>

        {/* Pin markers */}
        <For each={props.pins}>
          {(pin) => {
            const px = () => toPx(warpMs(pin.pinnedAtMs));
            return (
              <Show when={px() >= -2 && px() <= width() + 2}>
                <div
                  class="absolute top-0 z-20 h-8"
                  style={{ left: `${px()}px` }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.ctrlKey || e.metaKey) {
                      props.onDeletePin(pin.id);
                    } else {
                      setCursorMs(pin.pinnedAtMs);
                      props.onSelect(new Date(pin.pinnedAtMs));
                    }
                  }}
                >
                  <div class="absolute inset-y-0 w-px bg-red-500/70" />
                  <div class="absolute top-0 left-1 cursor-pointer whitespace-nowrap rounded-sm bg-surface/80 px-1.5 py-0.5 text-[10px] text-red-500 ring-1 ring-red-500/20 hover:ring-red-500/60">
                    {pin.label}
                  </div>
                </div>
              </Show>
            );
          }}
        </For>

        {/* CreatePin popover */}
        <Show when={createPinAt()}>
          {(target) => (
            <CreatePin
              leftPx={target().leftPx}
              containerWidth={width()}
              onConfirm={(label) => { props.onCreatePin(target().atMs, label); setCreatePinAt(null); }}
              onCancel={() => setCreatePinAt(null)}
            />
          )}
        </Show>

        {/* Rail */}
        <div class="relative h-8 overflow-hidden">
          <div class="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-edge" />
          <For each={gapMarkers()}>
            {(g) => (
              <div
                class="absolute inset-y-0 flex items-center justify-center overflow-hidden whitespace-nowrap text-[10px] text-ink-muted"
                style={{ left: `${g.left}px`, width: `${g.width}px` }}
              >
                {`·· ${g.label} ··`}
              </div>
            )}
          </For>
          {/* Marquee zoom selection */}
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
          {/* Diamond thumb */}
          <Show when={thumbPx() !== null}>
            <div
              class="pointer-events-none absolute top-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
              style={{ left: `${thumbPx()!}px` }}
            >
              <div class="size-3.5 rotate-45 bg-accent shadow" />
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

        {/* Edge time labels */}
        <span class="absolute top-full left-0 origin-top-left -rotate-12 text-[10px] text-ink-muted">
          {fmt(new Date(unwarp(viewW().start)))}
        </span>
        <span class="absolute top-full right-0 origin-top-right rotate-12 text-[10px] text-ink-muted">
          {fmt(new Date(unwarp(viewW().end)))}
        </span>
      </div>

      {/* Legend */}
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
