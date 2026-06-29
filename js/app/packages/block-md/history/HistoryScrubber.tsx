import type { HistorySession, VersionPin } from '@service-sync/client';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn } from '@ui';
import { group } from 'd3-array';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type Setter,
  Show,
} from 'solid-js';
import { CreatePin } from './CreatePin';
import { createTimelineScales, type WindowRange } from './createTimelineScales';
import { buildVolumeShape, VOLUME_BAND_H, type VolumeShape } from './timeline';
import { formatTimestamp, userColor, userLabel } from './utils';

type ScrubberUser = { id: string; label: string; color: string };
type ScrubberLane = { user: ScrubberUser; sessions: HistorySession[] };
const MIN_VIEW = 1000;
const DRAG_THRESHOLD = 4;
const THUMB_HIT_PX = 12;
const RAIL_HEIGHT_PX = 32;
const DOUBLE_CLICK_MS = 300;

export type HistoryScrubberProps = {
  sessions: readonly HistorySession[];
  pins: readonly VersionPin[];
  selectedAt: Accessor<Date | null>;
  isViewingHistory: Accessor<boolean>;
  setViewingHistory: Setter<boolean>;
  isScrubbedRightmost: Accessor<boolean>;
  onSelectRightmost: () => void;
  onSelect: (at: Date | null) => void;
  onCreatePin: (atMs: number, label: string) => void;
  onDeletePin: (pinId: string) => void;
  compact?: boolean;
};

export function HistoryScrubber(props: HistoryScrubberProps) {
  let containerRef!: HTMLDivElement;
  const size = createElementSize(() => containerRef);
  const width = () => size.width ?? 0;
  const [cursorMs, setCursorMs] = createSignal<number | null>(null);
  const [view, setView] = createSignal<WindowRange | null>(null);

  type Drag =
    // this is if we are paning
    | { mode: 'scrub'; startPx: number }
    // and this is if we are selecting a range to zoom in on
    | { mode: 'marquee'; startPx: number; curPx: number; inLanes: boolean };
  const [drag, setDrag] = createSignal<Drag | null>(null);

  const [hoverPx, setHoverPx] = createSignal<number | null>(null);
  const [hoverUser, setHoverUser] = createSignal<{
    user: ScrubberUser;
    x: number;
    y: number;
  } | null>(null);
  const [createPinAt, setCreatePinAt] = createSignal<{
    leftPx: number;
    atMs: number;
  } | null>(null);

  // users (with metadata for displaying them in their tracks)
  const users = createMemo<ScrubberUser[]>(() => {
    const ids = [...new Set(props.sessions.map((session) => session.userId))];
    return ids.map((id) => ({
      id,
      label: userLabel(id),
      color: userColor(id),
    }));
  });

  const lanes = createMemo<ScrubberLane[]>(() => {
    const byUser = group(props.sessions, (session) => session.userId);
    return users()
      .filter((user) => byUser.has(user.id))
      .map((user) => ({ user, sessions: byUser.get(user.id)! }));
  });

  const {
    compressedTimeline,
    visibleWindow,
    gapMarkers,
    warpedPositionToTimestamp,
    containerPositionToWarpedPosition,
    timestampToContainerPosition,
    containerPositionToTimestamp,
  } = createTimelineScales(() => props.sessions, width, view);

  const clampView = (start: number, end: number) => {
    const total = compressedTimeline().total;
    const span = Math.min(Math.max(MIN_VIEW, end - start), total);
    let clampedStart = Math.max(0, start);
    if (clampedStart + span > total) clampedStart = total - span;
    if (clampedStart < 0) clampedStart = 0;
    return { start: clampedStart, end: clampedStart + span };
  };

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

  // Converts page clientY to a pixel offset from the container top (unclamped).
  // Only used to distinguish clicks in the rail vs the user lanes below it.
  const localY = (clientY: number) => {
    return clientY - containerRef.getBoundingClientRect().top;
  };

  // Converts a pixel offset to a real timestamp: pixel → warped coord → ms.
  const placeAt = (pointerPx: number) => {
    if (width() - pointerPx <= THUMB_HIT_PX) {
      setCursorMs(null);
      props.onSelectRightmost();
      return;
    }
    const ms = containerPositionToTimestamp(pointerPx);
    props.setViewingHistory(true);
    setCursorMs(ms);
    props.onSelect(new Date(ms));
  };

  const thumbPx = createMemo<number | null>(() => {
    if (!props.isViewingHistory()) return null;
    if (props.isScrubbedRightmost()) return width();
    const cursor =
      drag()?.mode === 'scrub'
        ? cursorMs()
        : (props.selectedAt()?.getTime() ?? cursorMs());
    if (cursor === null) return null;
    const totalWidth = width();
    const candidatePx = timestampToContainerPosition(cursor);
    return candidatePx < -0.5 || candidatePx > totalWidth + 0.5
      ? null
      : candidatePx;
  });

  let lastClickMs = 0;

  const onPointerDown = (e: PointerEvent) => {
    if (createPinAt()) {
      setCreatePinAt(null);
      return;
    }
    setHoverPx(null);
    const wasViewingHistory = props.isViewingHistory();
    props.setViewingHistory(true);
    const pointerPx = localPx(e.clientX);
    const thumbPosition = thumbPx();
    if (!wasViewingHistory) {
      return;
    } else if (
      thumbPosition !== null &&
      Math.abs(pointerPx - thumbPosition) <= THUMB_HIT_PX
    ) {
      setDrag({ mode: 'scrub', startPx: pointerPx });
    } else {
      const inLanes = localY(e.clientY) > RAIL_HEIGHT_PX;
      setDrag({
        mode: 'marquee',
        startPx: pointerPx,
        curPx: pointerPx,
        inLanes,
      });
    }
    containerRef.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    const pointerPx = localPx(e.clientX);
    const activeDrag = drag();
    if (!activeDrag) {
      setHoverPx(pointerPx);
      return;
    }
    if (activeDrag.mode === 'scrub') {
      setCursorMs(containerPositionToTimestamp(pointerPx));
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
      // User drew a marquee selection — zoom the view to the selected pixel range.
      const warpLeft = containerPositionToWarpedPosition(
        Math.min(activeDrag.startPx, activeDrag.curPx)
      );
      const warpRight = containerPositionToWarpedPosition(
        Math.max(activeDrag.startPx, activeDrag.curPx)
      );
      setView(clampView(warpLeft, warpRight));
    } else if (!activeDrag.inLanes) {
      // Short click on the rail (not the user lanes) — open the create-pin popover.
      // We detect double-clicks manually here because the native dblclick event fires
      // after both pointerups, so the popover would flash open before the zoom reset.
      const now = Date.now();
      const isDouble = now - lastClickMs < DOUBLE_CLICK_MS;
      lastClickMs = now;
      if (!isDouble)
        setCreatePinAt({
          leftPx: pointerPx,
          atMs: containerPositionToTimestamp(pointerPx),
        });
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
    buildVolumeShape(props.sessions, timestampToContainerPosition, width())
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

        {/* Hover preview line */}
        <Show
          when={hoverPx() !== null && drag() === null && createPinAt() === null}
        >
          <div
            class="pointer-events-none absolute inset-y-0 z-10 w-px bg-accent/30"
            style={{ left: `${hoverPx() ?? 0}px` }}
          />
        </Show>

        {/* Pin markers */}
        <For each={props.pins}>
          {(pin) => {
            const px = () => timestampToContainerPosition(pin.pinnedAtMs);
            // 2px margin so pins at the very edge aren't clipped.
            return (
              <Show when={px() >= -2 && px() <= width() + 2}>
                <div
                  class="absolute top-0 z-20 h-8"
                  style={{ left: `${px()}px` }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    // you can hold cmd when you click a pin to delete it
                    if (e.ctrlKey || e.metaKey) {
                      props.onDeletePin(pin.id);
                    } else {
                      props.setViewingHistory(true);
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
              onConfirm={(label) => {
                props.onCreatePin(target().atMs, label);
                setCreatePinAt(null);
              }}
              onCancel={() => setCreatePinAt(null)}
            />
          )}
        </Show>

        {/* Rail */}
        <div class="relative h-8 overflow-hidden">
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
              <div class="relative h-2 overflow-hidden rounded-full">
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
            <div
              class="pointer-events-none absolute z-30 flex items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-ink text-xs shadow-lg ring-1 ring-edge-muted"
              style={{
                left: `${Math.max(0, Math.min(width() - 160, hover().x + 10))}px`,
                top: `${Math.max(0, hover().y - 30)}px`,
              }}
            >
              <span
                class="size-2 rounded-full"
                style={{ background: hover().user.color }}
              />
              <span class="max-w-40 truncate">{hover().user.label}</span>
            </div>
          )}
        </Show>

        {/* Edge time labels */}
        <span class="absolute top-full left-0 origin-top-left -rotate-12 text-[10px] text-ink-muted">
          {formatTimestamp(
            new Date(warpedPositionToTimestamp(visibleWindow().start))
          )}
        </span>
        <span class="absolute top-full right-0 origin-top-right rotate-12 text-[10px] text-ink-muted">
          {formatTimestamp(
            new Date(warpedPositionToTimestamp(visibleWindow().end))
          )}
        </span>
      </div>
    </div>
  );
}
