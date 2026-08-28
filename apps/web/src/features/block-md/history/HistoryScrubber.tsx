import type { HistorySession } from '@service-sync/client';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn } from '@ui';
import { group } from 'd3-array';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { createTimelineScales, type WindowRange } from './createTimelineScales';
import { useHistory } from './HistoryContext';
import { buildVolumeShape, VOLUME_BAND_H, type VolumeShape } from './timeline';
import { UserHoverTag } from './UserHoverTag';
import { formatTimestamp, userColor } from './utils';

type ScrubberUser = { id: string; displayName: () => string; color: string };
type ScrubberLane = { user: ScrubberUser; sessions: HistorySession[] };
const MIN_VIEW = 1;
const DRAG_THRESHOLD = 4;
const THUMB_HIT_PX = 12;

export function HistoryScrubber(props: { compact?: boolean }) {
  const history = useHistory();
  const sessions = history.sessions;
  let containerRef!: HTMLDivElement;
  let hoverLabelRef!: HTMLSpanElement;
  const size = createElementSize(() => containerRef);
  const width = () => size.width ?? 0;
  const [cursorMs, setCursorMs] = createSignal<number | null>(null);
  const [view, setView] = createSignal<WindowRange | null>(null);

  type Drag =
    | { mode: 'scrub'; startPx: number }
    | { mode: 'marquee'; startPx: number; curPx: number };
  const [drag, setDrag] = createSignal<Drag | null>(null);

  const [hoverPx, setHoverPx] = createSignal<number | null>(null);
  const [hoverUser, setHoverUser] = createSignal<{
    user: ScrubberUser;
    x: number;
    y: number;
  } | null>(null);
  // users (with metadata for displaying them in their tracks)
  const users = createMemo<ScrubberUser[]>(() => {
    const ids = [...new Set(sessions().map((session) => session.userId))];
    return ids.map((id) => ({
      id,
      displayName: () => history.userById(id).displayName(),
      color: userColor(id),
    }));
  });

  const lanes = createMemo<ScrubberLane[]>(() => {
    const byUser = group(sessions(), (session) => session.userId);
    return users()
      .filter((user) => byUser.has(user.id))
      .map((user) => ({ user, sessions: byUser.get(user.id)! }));
  });

  const {
    compressedTimeline,
    visibleWindow,
    gapMarkers,
    timestampToWarpedPosition,
    warpedPositionToTimestamp,
    containerPositionToWarpedPosition,
    timestampToContainerPosition,
    containerPositionToTimestamp,
  } = createTimelineScales(sessions, width, view);

  const clampView = (start: number, end: number) => {
    const total = compressedTimeline().total;
    const span = Math.min(Math.max(MIN_VIEW, end - start), total);
    let clampedStart = Math.max(0, start);
    if (clampedStart + span > total) clampedStart = total - span;
    if (clampedStart < 0) clampedStart = 0;
    return { start: clampedStart, end: clampedStart + span };
  };

  // This logic is basically so that we don't update lexical state as they scrub
  // more often than the screen itself refreshes.
  let rafId: number | null = null;
  onCleanup(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
  });
  const scheduleSelect = (ms: number) => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      rafId = null;
      history.enter(new Date(ms));
    });
  };

  createEffect(
    on(history.selectedAt, (selectedDate) => {
      if (!selectedDate || history.isLive()) return;
      const warped = timestampToWarpedPosition(selectedDate.getTime());
      const { start, end } = visibleWindow();
      if (warped >= start && warped <= end) return;
      const span = Math.max(end - start, compressedTimeline().total * 0.5);
      setView(clampView(warped - span / 2, warped + span / 2));
    })
  );

  createEffect(
    on(
      history.diff.session,
      (session) => {
        if (!session) {
          // Only zoom back out when the diff is truly dismissed (back to live).
          // Scrubbing to a timestamp also clears the session — don't yank the
          // zoom out from under the user in that case.
          if (history.isLive()) {
            setView({ start: 0, end: compressedTimeline().total });
          }
          return;
        }
        const warpStart = timestampToWarpedPosition(session.startMs);
        const warpEnd = timestampToWarpedPosition(session.endMs);
        const sessionSpan = warpEnd - warpStart;
        const padding = Math.max(
          sessionSpan * 0.5,
          compressedTimeline().total * 0.02
        );
        setView(clampView(warpStart - padding, warpEnd + padding));
      },
      { defer: true }
    )
  );

  // Exiting history drops any scrub/marquee zoom so the next open starts from
  // the full range. A null view falls back to the full window in the scales.
  createEffect(
    on(
      history.isOpen,
      (open) => {
        if (!open) setView(null);
      },
      { defer: true }
    )
  );

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const { start, end } = visibleWindow();
    const delta =
      Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (delta === 0) return;
    const shift = (delta / Math.max(1, width())) * (end - start);
    setView(clampView(start + shift, end + shift));
  };

  // Converts page clientX to a pixel offset within the container, clamped to [0, width].
  // Clamping keeps coords valid during pointer capture when the pointer drifts outside.
  const localPx = (clientX: number) => {
    const rect = containerRef.getBoundingClientRect();
    return Math.min(Math.max(0, clientX - rect.left), rect.width);
  };

  const localY = (clientY: number) =>
    clientY - containerRef.getBoundingClientRect().top;

  // Converts a pixel offset to a real timestamp: pixel → warped coord → ms.
  const placeAt = (pointerPx: number) => {
    if (width() - pointerPx <= THUMB_HIT_PX) {
      setCursorMs(null);
      history.enter();
      return;
    }
    const ms = containerPositionToTimestamp(pointerPx);
    setCursorMs(ms);
    history.enter(new Date(ms));
  };

  const thumbPx = createMemo<number | null>(() => {
    if (!history.isOpen()) return null;
    if (history.isLive()) return width();
    const cursor =
      drag()?.mode === 'scrub'
        ? cursorMs()
        : (history.selectedAt()?.getTime() ?? cursorMs());
    if (cursor === null) return null;
    const totalWidth = width();
    const candidatePx = timestampToContainerPosition(cursor);
    return candidatePx < -0.5 || candidatePx > totalWidth + 0.5
      ? null
      : candidatePx;
  });

  const onPointerDown = (e: PointerEvent) => {
    containerRef.setPointerCapture(e.pointerId);
    setHoverPx(null);
    history.open();
    const pointerPx = localPx(e.clientX);
    const thumbPosition = thumbPx();
    if (
      thumbPosition !== null &&
      Math.abs(pointerPx - thumbPosition) <= THUMB_HIT_PX
    ) {
      setDrag({ mode: 'scrub', startPx: pointerPx });
    } else {
      setDrag({ mode: 'marquee', startPx: pointerPx, curPx: pointerPx });
    }
  };

  const onPointerMove = (e: PointerEvent) => {
    const pointerPx = localPx(e.clientX);
    const activeDrag = drag();
    if (!activeDrag) {
      setHoverPx(pointerPx);
      return;
    }
    if (activeDrag.mode === 'scrub') {
      const ms = containerPositionToTimestamp(pointerPx);
      setCursorMs(ms);
      scheduleSelect(ms);
    } else {
      setDrag({ ...activeDrag, curPx: pointerPx });
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const activeDrag = drag();
    if (!activeDrag) return;
    setDrag(null);
    if (compressedTimeline().intervals.length === 0) return;
    const pointerPx = localPx(e.clientX);
    if (activeDrag.mode === 'scrub') {
      // User was dragging the thumb — commit the cursor position.
      placeAt(pointerPx);
      return;
    }
    if (Math.abs(activeDrag.curPx - activeDrag.startPx) > DRAG_THRESHOLD) {
      const warpLeft = containerPositionToWarpedPosition(
        Math.min(activeDrag.startPx, activeDrag.curPx)
      );
      const warpRight = containerPositionToWarpedPosition(
        Math.max(activeDrag.startPx, activeDrag.curPx)
      );
      const padding = (warpRight - warpLeft) * 0.2;
      setView(clampView(warpLeft - padding, warpRight + padding));
    } else {
      placeAt(pointerPx);
    }
  };

  // The active marquee drag, but only once it has crossed DRAG_THRESHOLD pixels —
  // used to render the selection box highlight while the user is drawing a zoom selection.
  const marquee = createMemo<Extract<Drag, { mode: 'marquee' }> | null>(() => {
    const activeDrag = drag();
    return activeDrag?.mode === 'marquee' &&
      Math.abs(activeDrag.curPx - activeDrag.startPx) > DRAG_THRESHOLD
      ? activeDrag
      : null;
  });

  const volume = createMemo<VolumeShape | null>(() =>
    buildVolumeShape(sessions(), timestampToContainerPosition, width())
  );

  return (
    <div
      class={cn(
        'flex w-full min-w-0 items-start gap-4',
        props.compact && 'flex-col items-stretch gap-6'
      )}
    >
      <div
        ref={containerRef}
        class={cn(
          'relative isolate min-w-0 flex-1 touch-none select-none',
          props.compact ? 'mb-2' : 'mb-4',
          props.compact ? 'mx-0 w-full' : 'mx-6'
        )}
        style={{
          cursor:
            drag()?.mode === 'scrub'
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
        onPointerLeave={() => {
          setHoverPx(null);
          setHoverUser(null);
        }}
        onWheel={onWheel}
        onDblClick={() =>
          setView({ start: 0, end: compressedTimeline().total })
        }
      >
        {/* Background activity meter */}
        <Show when={volume()}>
          {(vol) => (
            <svg
              class="pointer-events-none absolute inset-0 -z-10 size-full text-ink-muted"
              preserveAspectRatio="none"
              viewBox={`0 0 ${width()} ${VOLUME_BAND_H}`}
              aria-hidden="true"
            >
              <path d={vol().area} fill="currentColor" class="opacity-[0.08]" />
              <path
                d={vol().line}
                fill="none"
                stroke="currentColor"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
                class="opacity-25"
              />
            </svg>
          )}
        </Show>

        {/* Hover preview line + date label */}
        <Show when={hoverPx() !== null && drag() === null}>
          <div
            class="pointer-events-none absolute inset-y-0 z-10 w-px bg-accent/30"
            style={{ left: `${hoverPx() ?? 0}px` }}
          />
          <span
            ref={hoverLabelRef}
            class="pointer-events-none absolute top-full z-10 -translate-x-1/2 whitespace-nowrap rounded bg-surface px-1 text-[10px] text-ink"
            style={{
              left: `${Math.max((hoverLabelRef?.offsetWidth ?? 0) / 2, Math.min(hoverPx()!, width() - (hoverLabelRef?.offsetWidth ?? 0) / 2))}px`,
            }}
          >
            {formatTimestamp(
              new Date(containerPositionToTimestamp(hoverPx()!))
            )}
          </span>
        </Show>

        {/* Rail */}
        <div class="relative h-12 overflow-hidden">
          <div class="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded bg-edge" />
          <For each={gapMarkers()}>
            {(marker) => (
              <div
                class="absolute inset-y-0 flex items-center justify-center overflow-hidden whitespace-nowrap text-[10px] text-ink-muted"
                style={{ left: `${marker.left}px`, width: `${marker.width}px` }}
              >
                {`·· ${marker.label} ··`}
              </div>
            )}
          </For>
          {/* Marquee zoom selection */}
          <Show when={marquee()}>
            {(activeMarquee) => (
              <div
                class="absolute inset-y-0 z-10 border-accent border-x bg-accent/20"
                style={{
                  left: `${Math.min(activeMarquee().startPx, activeMarquee().curPx)}px`,
                  width: `${Math.abs(activeMarquee().curPx - activeMarquee().startPx)}px`,
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
              <div class="relative h-1 overflow-hidden rounded-full">
                <div class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-edge/60" />
                <For each={lane.sessions}>
                  {(session) => {
                    const left = () =>
                      timestampToContainerPosition(session.startMs);
                    const right = () =>
                      timestampToContainerPosition(session.endMs);
                    return (
                      <div
                        class="absolute inset-y-0 rounded-full"
                        // Stop the rail's scrub/marquee drag from starting so a
                        // bar click cleanly opens that session's diff.
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => {
                          if (
                            history.diff.session()?.startMs === session.startMs
                          ) {
                            history.diff.clear();
                          } else {
                            history.diff.view(session);
                          }
                        }}
                        onPointerEnter={(e) =>
                          setHoverUser({
                            user: lane.user,
                            x: localPx(e.clientX),
                            y: localY(e.clientY),
                          })
                        }
                        onPointerMove={(e) =>
                          setHoverUser({
                            user: lane.user,
                            x: localPx(e.clientX),
                            y: localY(e.clientY),
                          })
                        }
                        onPointerLeave={() => setHoverUser(null)}
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

        <Show when={hoverUser()}>
          {(hover) => (
            <UserHoverTag
              label={hover().user.displayName()}
              color={hover().user.color}
              left={Math.max(0, Math.min(width() - 160, hover().x + 10))}
              top={Math.max(0, hover().y - 30)}
            />
          )}
        </Show>

        {/* Edge time labels */}
        <span class="absolute top-full left-0 text-[10px] text-ink-muted">
          {formatTimestamp(
            new Date(warpedPositionToTimestamp(visibleWindow().start))
          )}
        </span>
        <span class="absolute top-full right-0 text-[10px] text-ink-muted">
          {formatTimestamp(
            new Date(warpedPositionToTimestamp(visibleWindow().end))
          )}
        </span>
      </div>
    </div>
  );
}
