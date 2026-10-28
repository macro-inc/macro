import { t } from '@app/lib/i18n';
import { Key } from '@solid-primitives/keyed';
import { cn } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { formatAge } from '../components/age-label';
import { BoardCanvas } from '../components/board-canvas';
import { BoardNode } from '../components/board-node';
import { ZoneTitle, zoneColor } from '../components/glyphs';
import { RiverChip } from '../components/river-chip';
import { ZoomToolbar } from '../components/zoom-toolbar';
import { useBoard } from '../context/board-context';
import type { Bounds } from '../core/camera';
import {
  layoutRiver,
  RIVER_AXIS_HEIGHT,
  RIVER_CHIP_WIDTH,
  RIVER_LANE_LABEL,
} from '../core/layout-river';
import { isFaded } from '../core/lifecycle';
import { createBoardStage } from '../primitives/board-stage';
import {
  BoardStatus,
  itemLabel,
  nodeBindings,
  type VariantProps,
} from './variant-shared';

/** V1C: everything on one timeline, newest on the right, a lane per kind. */
export function RiverBoard(props: VariantProps) {
  const board = useBoard();
  const stage = createBoardStage({
    variant: 'v1c',
    memory: props.memory,
    nodes: props.scene.items,
    layoutBounds: (): Bounds | undefined => layout().bounds,
    fallbackSize: { width: RIVER_CHIP_WIDTH, height: 96 },
    maxFitScale: 0.9,
  });
  // Minute steps keep chips from creeping left on every clock tick.
  const layoutNow = createMemo(() => Math.floor(board.now() / 60_000) * 60_000);
  const layout = createMemo(() =>
    layoutRiver(stage.flowing(), layoutNow(), stage.sizes.size)
  );
  const riverLeft = () => (layout().bounds?.x ?? -RIVER_LANE_LABEL) - 40;
  const riverBottom = () => {
    const last = layout().lanes.at(-1);
    return last ? last.y + last.height : 0;
  };
  const pinnedTickLeft = (worldX: number) =>
    stage.camera.camera().x + worldX * stage.camera.camera().scale;
  // Lane names stay pinned to the left edge of the screen while panning.
  const pinnedLaneTop = (laneY: number) =>
    stage.camera.camera().y + laneY * stage.camera.camera().scale;

  return (
    <BoardCanvas
      ref={stage.camera.bind}
      camera={stage.camera.camera()}
      panning={stage.camera.panning()}
      label={t('board.v1cName')}
      overlay={
        <>
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 top-0 z-20 h-8 border-b border-edge-muted bg-page/85 backdrop-blur-sm"
          >
            <For each={layout().ticks}>
              {(tick) => (
                <span
                  class={cn(
                    'absolute top-2 -translate-x-1/2 text-xs whitespace-nowrap tabular-nums',
                    tick.ageMs === 0
                      ? 'rounded-full bg-accent px-2 font-semibold text-accent-contrast'
                      : 'text-ink-muted'
                  )}
                  style={{ left: `${pinnedTickLeft(tick.x)}px` }}
                >
                  {tick.ageMs === 0
                    ? t('board.now')
                    : formatAge(layoutNow() - tick.ageMs, layoutNow())}
                </span>
              )}
            </For>
          </div>
          <div class="pointer-events-none absolute inset-y-0 left-0 z-20 w-0">
            <For each={layout().lanes}>
              {(lane) => (
                <div
                  class="absolute left-3 flex h-8 w-max items-center rounded-full border border-edge-muted bg-panel/90 px-3 text-xs shadow-sm backdrop-blur-sm"
                  style={{
                    top: `${Math.max(40, pinnedLaneTop(lane.y) + 8)}px`,
                  }}
                >
                  <ZoneTitle zone={lane.zone} count={lane.count} />
                </div>
              )}
            </For>
          </div>
          <BoardStatus
            scene={props.scene}
            memory={props.memory}
            onRetry={props.onRetry}
          />
          <ZoomToolbar
            scale={stage.camera.camera().scale}
            fitted={stage.camera.isFitted()}
            onZoomIn={stage.camera.zoomIn}
            onZoomOut={stage.camera.zoomOut}
            onFit={stage.camera.fit}
          />
        </>
      }
    >
      <For each={layout().lanes}>
        {(lane, index) => (
          <div
            aria-hidden="true"
            class="pointer-events-none absolute rounded-2xl"
            classList={{
              'bg-[color-mix(in_oklch,var(--board-zone)_6%,transparent)]':
                index() % 2 === 0,
              'bg-[color-mix(in_oklch,var(--board-zone)_3%,transparent)]':
                index() % 2 === 1,
            }}
            style={{
              '--board-zone': zoneColor(lane.zone),
              left: `${riverLeft()}px`,
              top: `${lane.y}px`,
              width: `${-riverLeft() + 120}px`,
              height: `${lane.height}px`,
            }}
          />
        )}
      </For>
      <For each={layout().ticks}>
        {(tick) => (
          <Show when={tick.x >= riverLeft()}>
            <div
              aria-hidden="true"
              class="pointer-events-none absolute w-px bg-edge-muted"
              style={{
                left: `${tick.x}px`,
                top: `${-RIVER_AXIS_HEIGHT}px`,
                height: `${riverBottom() + RIVER_AXIS_HEIGHT}px`,
              }}
            />
          </Show>
        )}
      </For>
      <div
        aria-hidden="true"
        class="pointer-events-none absolute w-0.5 rounded-full bg-accent"
        style={{
          left: '-1px',
          top: `${-RIVER_AXIS_HEIGHT + 22}px`,
          height: `${riverBottom() + RIVER_AXIS_HEIGHT - 22}px`,
        }}
      />
      <Key each={props.scene.items()} by="key">
        {(item) => {
          const key = () => item().key;
          const laidOut = () => layout().chips.get(key());
          const point = () => stage.place(key(), laidOut());
          const bind = nodeBindings(stage, item, point, props);
          return (
            <Show when={point()}>
              {(at) => (
                <BoardNode
                  ref={(element) => stage.sizes.measure(element, key())}
                  x={at().x}
                  y={at().y}
                  width={RIVER_CHIP_WIDTH}
                  label={itemLabel(item(), stage.isMoved(key()))}
                  dismissLabel={t('board.removeItem', { title: item().title })}
                  dragging={bind.dragging()}
                  faded={isFaded(props.scene.freshness(key()))}
                  onPointerDown={bind.onPointerDown}
                  onOpen={bind.onOpen}
                  onKeyDown={bind.onKeyDown}
                  onDismiss={bind.onDismiss}
                  shapeClass="rounded-xl"
                >
                  <RiverChip
                    item={item()}
                    now={board.now()}
                    detail={stage.detail()}
                    freshness={props.scene.freshness(key())}
                    moved={stage.isMoved(key())}
                    Avatar={board.Avatar}
                  />
                </BoardNode>
              )}
            </Show>
          );
        }}
      </Key>
    </BoardCanvas>
  );
}
