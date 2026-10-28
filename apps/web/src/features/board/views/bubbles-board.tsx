import { t } from '@app/lib/i18n';
import { Key } from '@solid-primitives/keyed';
import { createMemo, For, Show } from 'solid-js';
import { BoardCanvas } from '../components/board-canvas';
import { BoardNode } from '../components/board-node';
import { BubbleFace } from '../components/bubble-face';
import { ZoneGlow } from '../components/zone-frame';
import { ZoomToolbar } from '../components/zoom-toolbar';
import { useBoard } from '../context/board-context';
import type { Bounds } from '../core/camera';
import {
  BUBBLE_MAX_RADIUS,
  bubbleRadius,
  layoutBubbles,
} from '../core/layout-bubbles';
import { isFaded } from '../core/lifecycle';
import { createBoardStage } from '../primitives/board-stage';
import {
  BoardStatus,
  itemLabel,
  nodeBindings,
  type VariantProps,
} from './variant-shared';

/** V1B: faces with their newest message, packed into neighborhood clusters. */
export function BubblesBoard(props: VariantProps) {
  const board = useBoard();
  const stage = createBoardStage({
    variant: 'v1b',
    memory: props.memory,
    nodes: props.scene.items,
    layoutBounds: (): Bounds | undefined => layout().bounds,
    fallbackSize: {
      width: BUBBLE_MAX_RADIUS * 2,
      height: BUBBLE_MAX_RADIUS * 2,
    },
  });
  // Sizes follow how recent things are; step the clock so faces do not
  // shuffle on every tick.
  const layoutNow = createMemo(
    () => Math.floor(board.now() / 300_000) * 300_000
  );
  const layout = createMemo(() => layoutBubbles(stage.flowing(), layoutNow()));

  return (
    <BoardCanvas
      ref={stage.camera.bind}
      camera={stage.camera.camera()}
      panning={stage.camera.panning()}
      label={t('board.v1bName')}
      overlay={
        <>
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
      <For each={layout().clusters}>
        {(cluster) => (
          <ZoneGlow
            zone={cluster.zone}
            x={cluster.x}
            y={cluster.y}
            r={cluster.r}
            count={cluster.count}
            labelScale={Math.min(
              2.4,
              Math.max(1, 0.85 / stage.camera.camera().scale)
            )}
          />
        )}
      </For>
      <Key each={props.scene.items()} by="key">
        {(item) => {
          const key = () => item().key;
          const laidOut = () => layout().nodes.get(key());
          const point = () => stage.place(key(), laidOut());
          const radius = () =>
            laidOut()?.r ?? bubbleRadius(item(), layoutNow());
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
                  dismissClass="top-1/2 -left-8 -translate-y-1/2"
                >
                  <BubbleFace
                    item={item()}
                    r={radius()}
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
