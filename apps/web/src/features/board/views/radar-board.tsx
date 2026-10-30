import { t } from '@app/lib/i18n';
import { Key } from '@solid-primitives/keyed';
import { createMemo, For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { BoardCanvas } from '../components/board-canvas';
import { BoardNode } from '../components/board-node';
import { ZoneTitle, zoneColor } from '../components/glyphs';
import { RadarNode } from '../components/radar-node';
import { ZoomToolbar } from '../components/zoom-toolbar';
import { useBoard } from '../context/board-context';
import type { Bounds } from '../core/camera';
import {
  layoutRadar,
  RADAR_CENTER_RADIUS,
  RADAR_RINGS,
  type RadarRing,
  radarAngle,
  radarPoint,
  radarRingRadius,
} from '../core/layout-radar';
import { isFaded } from '../core/lifecycle';
import { createBoardStage } from '../primitives/board-stage';
import {
  BoardStatus,
  itemLabel,
  nodeBindings,
  type VariantProps,
} from './variant-shared';

function ringName(ring: RadarRing): string {
  return match(ring)
    .with('needs-you', () => t('board.ringNeedsYou'))
    .with('new', () => t('board.ringNew'))
    .with('today', () => t('board.ringToday'))
    .with('earlier', () => t('board.ringEarlier'))
    .exhaustive();
}

/** V1D: the viewer at the center, what needs them on the innermost ring. */
export function RadarBoard(props: VariantProps) {
  const board = useBoard();
  const stage = createBoardStage({
    variant: 'v1d',
    memory: props.memory,
    nodes: props.scene.items,
    layoutBounds: (): Bounds | undefined => layout().bounds,
    fallbackSize: { width: 44, height: 44 },
  });
  const layoutNow = createMemo(
    () => Math.floor(board.now() / 300_000) * 300_000
  );
  const layout = createMemo(() => layoutRadar(stage.flowing(), layoutNow()));
  const lift = () =>
    Math.min(2.2, Math.max(1, 0.85 / stage.camera.camera().scale));
  const viewer = () =>
    props.scene
      .items()
      .flatMap((item) => item.participants)
      .find((person) => person.isSelf);

  return (
    <BoardCanvas
      ref={stage.camera.bind}
      camera={stage.camera.camera()}
      panning={stage.camera.panning()}
      label={t('board.v1dName')}
      overlay={
        <>
          <BoardStatus
            view={props.scene.view()}
            onRetry={props.onRetry}
            onShowSettled={() => props.memory.setShowSettled(true)}
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
      <svg
        aria-hidden="true"
        class="pointer-events-none absolute top-0 left-0 overflow-visible"
        width="1"
        height="1"
      >
        <circle
          r={radarRingRadius('needs-you') + 60}
          class="fill-[color-mix(in_oklch,var(--color-accent)_7%,transparent)]"
        />
        <For each={RADAR_RINGS}>
          {(ring) => (
            <circle
              r={radarRingRadius(ring)}
              class="fill-none stroke-[color-mix(in_oklch,var(--color-ink)_16%,transparent)]"
              stroke-width={ring === 'needs-you' ? 2 : 1.25}
              stroke-dasharray={ring === 'earlier' ? '4 6' : undefined}
              vector-effect="non-scaling-stroke"
            />
          )}
        </For>
        <For each={layout().sectors}>
          {(sector) => {
            const from = () =>
              radarPoint(sector.start, RADAR_CENTER_RADIUS + 30);
            const to = () =>
              radarPoint(sector.start, layout().outerRadius + 70);
            return (
              <line
                x1={from().x}
                y1={from().y}
                x2={to().x}
                y2={to().y}
                class="stroke-[color-mix(in_oklch,var(--color-ink)_10%,transparent)]"
                stroke-width="1"
                vector-effect="non-scaling-stroke"
              />
            );
          }}
        </For>
      </svg>
      <For each={RADAR_RINGS}>
        {(ring) => (
          <span
            aria-hidden="true"
            class="pointer-events-none absolute -translate-1/2 rounded-full border border-edge-muted bg-page px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-ink-muted"
            classList={{
              'text-accent border-[color-mix(in_oklch,var(--color-accent)_45%,transparent)]':
                ring === 'needs-you',
            }}
            style={{
              left: '0px',
              top: `${-radarRingRadius(ring)}px`,
              scale: String(lift()),
            }}
          >
            {ringName(ring)}
          </span>
        )}
      </For>
      <For each={layout().sectors}>
        {(sector) => {
          const at = () =>
            radarPoint(
              (sector.start + sector.end) / 2,
              layout().outerRadius + 120
            );
          return (
            <div
              aria-hidden="true"
              class="pointer-events-none absolute -translate-1/2 rounded-full border bg-panel px-3 py-1.5 text-sm shadow-sm"
              style={{
                '--board-zone': zoneColor(sector.zone),
                'border-color':
                  'color-mix(in oklch, var(--board-zone) 35%, transparent)',
                left: `${at().x}px`,
                top: `${at().y}px`,
                scale: String(lift()),
              }}
            >
              <ZoneTitle zone={sector.zone} count={sector.count} />
            </div>
          );
        }}
      </For>
      <div
        aria-hidden="true"
        class="pointer-events-none absolute flex -translate-1/2 flex-col items-center gap-2"
        style={{ left: '0px', top: '0px' }}
      >
        <span class="rounded-full shadow-[0_0_0_6px_color-mix(in_oklch,var(--color-accent)_25%,transparent),0_0_40px_color-mix(in_oklch,var(--color-accent)_35%,transparent)]">
          <Show
            when={viewer()}
            fallback={<span class="block size-16 rounded-full bg-accent" />}
          >
            {(person) => <board.Avatar author={person()} size={64} />}
          </Show>
        </span>
        <span class="text-sm font-semibold text-ink">{t('board.you')}</span>
      </div>
      <Key each={props.scene.items()} by="key">
        {(item) => {
          const key = () => item().key;
          const laidOut = () => layout().nodes.get(key());
          const point = () => stage.place(key(), laidOut());
          const bind = nodeBindings(stage, item, point, props);
          return (
            <Show when={point()}>
              {(at) => (
                <BoardNode
                  centered
                  x={at().x}
                  y={at().y}
                  label={itemLabel(item(), stage.isMoved(key()))}
                  dismissLabel={t('board.removeItem', { title: item().title })}
                  dragging={bind.dragging()}
                  faded={isFaded(props.scene.freshness(key()))}
                  onPointerDown={bind.onPointerDown}
                  onOpen={bind.onOpen}
                  onKeyDown={bind.onKeyDown}
                  onDismiss={bind.onDismiss}
                  shapeClass="rounded-full"
                  dismissClass="-bottom-2 -left-2"
                >
                  <RadarNode
                    item={item()}
                    angle={radarAngle(at())}
                    now={board.now()}
                    scale={stage.camera.camera().scale}
                    live={props.scene.freshness(key()) === 'live'}
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
