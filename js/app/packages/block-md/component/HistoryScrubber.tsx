import type { HistorySession } from '@service-sync/client';
import { makeResizeObserver } from '@solid-primitives/resize-observer';
import { createMemo, createSignal, For, onMount, Show } from 'solid-js';

/**
 * History scrubber on a warped time axis: active editing stretches keep real
 * time scale while idle gaps collapse (shown as `⋯ 3d ⋯` break markers). One
 * lane per user below the rail shows that user's sessions. Drag on the rail to
 * zoom into a region, scroll to pan, double-click to reset; click to seek.
 */
type ScrubberUser = { id: string; label: string; color: string };

const SESSION_GAP_MS = 10 * 60 * 1000;
const LANE_HUES = [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
// Smallest warped zoom window (≈1s of active time).
const MIN_VIEW = 1000;
// Pointer travel (px) above which a press is a zoom-drag, not a click-to-seek.
const DRAG_THRESHOLD = 4;
// On open, focus the most recent this-many active sessions.
const DEFAULT_SESSIONS = 6;

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
  // Macro user ids look like "macro|person@example.com".
  const tail = userId.includes('|') ? userId.split('|')[1] : userId;
  return tail || userId;
}

function laneEditCount(sessions: { count: number }[]): number {
  return sessions.reduce((n, s) => n + s.count, 0);
}

function humanizeDuration(ms: number): string {
  const d = ms / 86_400_000;
  if (d >= 1) return `${Math.round(d)}d`;
  const h = ms / 3_600_000;
  if (h >= 1) return `${Math.round(h)}h`;
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}

export function HistoryScrubber(props: {
  sessions: readonly HistorySession[];
  onSelect: (tsMs: number) => void;
}) {
  let trackRef!: HTMLDivElement;
  const [width, setWidth] = createSignal(0);
  // Selected moment as wall-clock ms (survives resize + zoom/pan). null = unset.
  const [cursorMs, setCursorMs] = createSignal<number | null>(null);
  const [hidden, setHidden] = createSignal<ReadonlySet<string>>(new Set());
  // Explicit zoom window in warped units; null = the default (last N sessions).
  const [view, setView] = createSignal<{ start: number; end: number } | null>(
    null
  );
  const [hoveredLane, setHoveredLane] = createSignal<{
    user: ScrubberUser;
    sessions: HistorySession[];
  } | null>(null);
  // Active pointer drag: scrub (dragging the diamond) or marquee-zoom (dragging
  // the rail). null when idle.
  const [drag, setDrag] = createSignal<
    | { mode: 'scrub' }
    | { mode: 'marquee'; startPx: number; curPx: number }
    | null
  >(null);
  // Live pointer x (px) while dragging the thumb, for the faint preview cursor.
  // null when not scrubbing. The thumb itself only moves on release (commit).
  const [scrubPx, setScrubPx] = createSignal<number | null>(null);

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

  onMount(() => {
    const { observe } = makeResizeObserver(() =>
      setWidth(trackRef.getBoundingClientRect().width)
    );
    observe(trackRef);
    setWidth(trackRef.getBoundingClientRect().width);
  });

  // Monotonic map wall-clock ms → warped coord: active intervals (sessions
  // merged within SESSION_GAP_MS) keep real duration; idle gaps log-compress.
  const warp = createMemo(() => {
    if (props.sessions.length === 0) {
      return {
        intervals: [] as { startMs: number; endMs: number; w0: number }[],
        gaps: [] as { w0: number; w1: number; dtMs: number }[],
        firstMs: 0,
        lastMs: 0,
        total: 1,
      };
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
        merged.push({ startMs: s.startMs, endMs: s.endMs });
      }
    }

    const knee = SESSION_GAP_MS;
    const intervals: { startMs: number; endMs: number; w0: number }[] = [];
    const gaps: { w0: number; w1: number; dtMs: number }[] = [];
    let w = 0;
    for (let i = 0; i < merged.length; i++) {
      if (i > 0) {
        const dtMs = merged[i].startMs - merged[i - 1].endMs;
        const delta = knee * (1 + Math.log(1 + (dtMs - knee) / knee));
        gaps.push({ w0: w, w1: w + delta, dtMs });
        w += delta;
      }
      const m = merged[i];
      intervals.push({ startMs: m.startMs, endMs: m.endMs, w0: w });
      w += m.endMs - m.startMs;
    }

    return {
      intervals,
      gaps,
      firstMs: merged[0].startMs,
      lastMs: merged[merged.length - 1].endMs,
      total: w || 1,
    };
  });

  const warpMs = (ms: number): number => {
    const { intervals, total, firstMs, lastMs } = warp();
    if (intervals.length === 0) return 0;
    if (ms <= firstMs) return 0;
    if (ms >= lastMs) return total;
    for (let i = 0; i < intervals.length; i++) {
      const iv = intervals[i];
      if (ms <= iv.endMs) {
        if (ms >= iv.startMs) return iv.w0 + (ms - iv.startMs);
        const prev = intervals[i - 1];
        const w0 = prev.w0 + (prev.endMs - prev.startMs);
        const frac = (ms - prev.endMs) / (iv.startMs - prev.endMs || 1);
        return w0 + frac * (iv.w0 - w0);
      }
    }
    return total;
  };

  const unwarp = (wv: number): number => {
    const { intervals, firstMs, lastMs, total } = warp();
    if (intervals.length === 0) return 0;
    if (wv <= 0) return firstMs;
    if (wv >= total) return lastMs;
    for (let i = 0; i < intervals.length; i++) {
      const iv = intervals[i];
      const ivW1 = iv.w0 + (iv.endMs - iv.startMs);
      if (wv <= ivW1) {
        if (wv >= iv.w0) return iv.startMs + (wv - iv.w0);
        const prev = intervals[i - 1];
        const prevW1 = prev.w0 + (prev.endMs - prev.startMs);
        const frac = (wv - prevW1) / (iv.w0 - prevW1 || 1);
        return prev.endMs + frac * (iv.startMs - prev.endMs);
      }
    }
    return lastMs;
  };

  // Default window when the user hasn't zoomed/panned: the last N active
  // sessions (scroll left to see older, double-click to see everything).
  const defaultWindow = createMemo(() => {
    const { intervals, total } = warp();
    if (intervals.length <= DEFAULT_SESSIONS) return { start: 0, end: total };
    return { start: intervals[intervals.length - DEFAULT_SESSIONS].w0, end: total };
  });

  const viewW = createMemo(() => view() ?? defaultWindow());

  const toPx = (wv: number) => {
    const { start, end } = viewW();
    return ((wv - start) / (end - start || 1)) * width();
  };
  const fromPx = (px: number) => {
    const { start, end } = viewW();
    return start + (px / Math.max(1, width())) * (end - start || 1);
  };

  // Clamp a warped window to [0, total], keeping its requested span.
  const clampView = (start: number, end: number) => {
    const total = warp().total;
    const span = Math.min(Math.max(MIN_VIEW, end - start), total);
    let s = Math.max(0, start);
    if (s + span > total) s = total - span;
    if (s < 0) s = 0;
    return { start: s, end: s + span };
  };

  // Scroll = pan horizontally (no zoom). Drag-to-select handles zooming.
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
    const rect = trackRef.getBoundingClientRect();
    return Math.min(Math.max(0, clientX - rect.left), rect.width);
  };

  // Commit a selection: move the thumb AND request that moment's state.
  const commit = (clientX: number) => {
    const ms = unwarp(fromPx(localPx(clientX)));
    setCursorMs(ms);
    props.onSelect(ms);
  };

  // Press on the diamond → scrub (drag the thumb through time).
  const onThumbDown = (e: PointerEvent) => {
    e.stopPropagation(); // don't start a zoom-marquee on the rail
    setDrag({ mode: 'scrub' });
    trackRef.setPointerCapture(e.pointerId);
  };

  // Press on the rail → drag a region to zoom, or click (no drag) to seek.
  const onPointerDown = (e: PointerEvent) => {
    const px = localPx(e.clientX);
    setDrag({ mode: 'marquee', startPx: px, curPx: px });
    trackRef.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag();
    if (!d) return;
    if (d.mode === 'scrub') {
      setScrubPx(localPx(e.clientX)); // faint preview cursor; commit on release
    } else {
      setDrag({ mode: 'marquee', startPx: d.startPx, curPx: localPx(e.clientX) });
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = drag();
    if (!d) return;
    setDrag(null);
    setScrubPx(null);
    if (warp().intervals.length === 0) return;
    if (d.mode === 'scrub') {
      commit(e.clientX); // release → select that moment
      return;
    }
    if (Math.abs(d.curPx - d.startPx) > DRAG_THRESHOLD) {
      // Dragged a region → zoom into it.
      const a = fromPx(Math.min(d.startPx, d.curPx));
      const b = fromPx(Math.max(d.startPx, d.curPx));
      setView(clampView(a, b));
    } else {
      // A click → seek.
      commit(e.clientX);
    }
  };

  // The in-progress marquee rectangle (only while dragging the rail).
  const marquee = createMemo(() => {
    const d = drag();
    return d && d.mode === 'marquee' ? d : null;
  });

  // Pixel position of the scrub cursor; null when outside the window. Defaults
  // to the latest edit (right edge) before the first scrub.
  const thumbPx = createMemo<number | null>(() => {
    const c = cursorMs();
    const w = width();
    const px = c === null ? w : toPx(warpMs(c));
    return px < -0.5 || px > w + 0.5 ? null : px;
  });

  // Collapsed idle gaps within the current window, for break markers.
  const gapMarkers = createMemo(() => {
    const w = width();
    const out: { left: number; width: number; label: string }[] = [];
    for (const g of warp().gaps) {
      const l = toPx(g.w0);
      const r = toPx(g.w1);
      if (r < 0 || l > w) continue;
      out.push({
        left: l,
        width: Math.max(2, r - l),
        label: humanizeDuration(g.dtMs),
      });
    }
    return out;
  });

  // One lane per shown user: that user's sessions on the shared warped scale.
  const lanes = createMemo(() => {
    const h = hidden();
    const byUser = new Map<string, HistorySession[]>();
    for (const s of props.sessions) {
      if (h.has(s.userId)) continue;
      let arr = byUser.get(s.userId);
      if (!arr) {
        arr = [];
        byUser.set(s.userId, arr);
      }
      arr.push(s);
    }
    return users()
      .filter((u) => byUser.has(u.id))
      .map((u) => ({ user: u, sessions: byUser.get(u.id)! }));
  });

  const fmt = (ms: number) =>
    new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  return (
    <div class="flex flex-1 items-start gap-4">
      <div class="relative mx-6 mb-4 min-w-0 flex-1">
        <div
          ref={trackRef}
          class="relative h-8 cursor-crosshair touch-none select-none overflow-hidden"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
          onDblClick={() => setView({ start: 0, end: warp().total })}
        >
          {/* rail */}
          <div class="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-edge" />
          {/* collapsed-gap break markers */}
          <For each={gapMarkers()}>
            {(g) => (
              <div
                class="absolute inset-y-0 flex items-center justify-center overflow-hidden whitespace-nowrap text-[10px] text-ink-muted"
                style={{ left: `${g.left}px`, width: `${g.width}px` }}
              >
                {/* hide once too narrow to read; two-dot leaders, no background */}
                {g.width >= 36 ? `‥ ${g.label} ‥` : g.width >= 12 ? '‥' : ''}
              </div>
            )}
          </For>
          {/* drag-to-zoom selection rectangle */}
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
          {/* faint preview cursor at the pointer while dragging the thumb,
              before release commits the selection */}
          <Show when={scrubPx() !== null}>
            <div
              class="absolute inset-y-0 w-px bg-accent/60"
              style={{ left: `${scrubPx() ?? 0}px` }}
            />
          </Show>
          {/* thumb (diamond) — draggable scrub handle; the wrapper is a larger
              invisible hit area. Hidden when the moment is off-window. */}
          <Show when={thumbPx() !== null}>
            <div
              class="absolute top-1/2 flex size-4 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center justify-center"
              style={{ left: `${thumbPx() ?? 0}px` }}
              onPointerDown={onThumbDown}
            >
              <div class="size-2.5 rotate-45 bg-accent shadow" />
            </div>
          </Show>
        </div>
        {/* hovered-lane name chip, floated just above the rail */}
        <Show when={hoveredLane()}>
          {(lane) => (
            <div class="-top-6 pointer-events-none absolute left-0 z-10 flex items-center gap-1.5 rounded border border-edge bg-surface px-1.5 py-0.5 text-[11px] text-ink shadow">
              <span
                class="size-2 shrink-0 rounded-full"
                style={{ background: lane().user.color }}
              />
              <span class="max-w-60 truncate">{lane().user.label}</span>
              <span class="text-ink-muted">
                · {laneEditCount(lane().sessions)} edits
              </span>
            </div>
          )}
        </Show>
        {/* per-user session lanes on the same warped scale */}
        <div class="flex flex-col gap-0.5">
          <For each={lanes()}>
            {(lane) => (
              <div
                class="relative h-2 overflow-hidden rounded-full"
                classList={{
                  'bg-hover': hoveredLane()?.user.id === lane.user.id,
                }}
                onMouseEnter={() => setHoveredLane(lane)}
                onMouseLeave={() => setHoveredLane(null)}
              >
                {/* faint rail so the lane reads as a track, not floating bars */}
                <div class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-edge/60" />
                <For each={lane.sessions}>
                  {(s) => {
                    const left = () => toPx(warpMs(s.startMs));
                    const right = () => toPx(warpMs(s.endMs));
                    return (
                      <div
                        class="absolute inset-y-0 rounded-full"
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
        {/* diagonal end labels: the visible window's real-time edges */}
        <span class="absolute top-full left-0 origin-top-left -rotate-12 text-[10px] text-ink-muted">
          {fmt(unwarp(viewW().start))}
        </span>
        <span class="absolute top-full right-0 origin-top-right rotate-12 text-[10px] text-ink-muted">
          {fmt(unwarp(viewW().end))}
        </span>
      </div>
      {/* legend: who is who; click to toggle a user's lane. Scrolls when many. */}
      <Show when={users().length > 0}>
        <div class="flex max-h-32 shrink-0 flex-col gap-0.5 overflow-y-auto overscroll-contain pr-1 text-xs">
          <For each={users()}>
            {(u) => (
              <button
                type="button"
                class="flex items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-hover"
                classList={{
                  'opacity-40': hidden().has(u.id),
                  'bg-hover': hoveredLane()?.user.id === u.id,
                }}
                onClick={() => toggleUser(u.id)}
                onMouseEnter={() =>
                  setHoveredLane(lanes().find((l) => l.user.id === u.id) ?? null)
                }
                onMouseLeave={() => setHoveredLane(null)}
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
