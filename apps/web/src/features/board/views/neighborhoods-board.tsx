import { t } from '@app/lib/i18n';
import { Key } from '@solid-primitives/keyed';
import { createMemo, For, Show } from 'solid-js';
import { BoardCanvas } from '../components/board-canvas';
import { BoardNode } from '../components/board-node';
import { ConversationCard } from '../components/conversation-card';
import { ZoneFrame } from '../components/zone-frame';
import { ZoomToolbar } from '../components/zoom-toolbar';
import { useBoard } from '../context/board-context';
import type { Bounds } from '../core/camera';
import {
  layoutNeighborhoods,
  NEIGHBORHOOD_METRICS,
} from '../core/layout-neighborhoods';
import { isFaded } from '../core/lifecycle';
import { createBoardStage } from '../primitives/board-stage';
import {
  BoardStatus,
  itemLabel,
  nodeBindings,
  type VariantProps,
} from './variant-shared';

/** V1A: conversation cards in framed neighborhoods. */
export function NeighborhoodsBoard(props: VariantProps) {
  const board = useBoard();
  const stage = createBoardStage({
    variant: 'v1a',
    memory: props.memory,
    nodes: props.scene.items,
    layoutBounds: (): Bounds | undefined => layout().bounds,
    fallbackSize: { width: NEIGHBORHOOD_METRICS.columnWidth, height: 160 },
  });
  const layout = createMemo(() =>
    layoutNeighborhoods(stage.flowing(), stage.sizes.size)
  );

  return (
    <BoardCanvas
      ref={stage.camera.bind}
      camera={stage.camera.camera()}
      panning={stage.camera.panning()}
      label={t('board.v1aName')}
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
      <For each={layout().zones}>
        {(zone) => (
          <ZoneFrame
            zone={zone.zone}
            bounds={zone.bounds}
            count={zone.count}
            unread={zone.unread}
            detail={stage.detail()}
          />
        )}
      </For>
      <Key each={props.scene.items()} by="key">
        {(item) => {
          const key = () => item().key;
          const laidOut = () => layout().cards.get(key());
          const point = () => stage.place(key(), laidOut());
          const bind = nodeBindings(stage, item, point, props);
          return (
            <Show when={point()}>
              {(at) => (
                <BoardNode
                  ref={(element) => stage.sizes.measure(element, key())}
                  x={at().x}
                  y={at().y}
                  width={
                    laidOut()?.width ??
                    stage.sizes.size(key())?.width ??
                    NEIGHBORHOOD_METRICS.columnWidth
                  }
                  label={itemLabel(item(), stage.isMoved(key()))}
                  dismissLabel={t('board.removeItem', { title: item().title })}
                  dragging={bind.dragging()}
                  faded={isFaded(props.scene.freshness(key()))}
                  onPointerDown={bind.onPointerDown}
                  onOpen={bind.onOpen}
                  onKeyDown={bind.onKeyDown}
                  onDismiss={bind.onDismiss}
                  shapeClass="rounded-2xl"
                >
                  <ConversationCard
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
