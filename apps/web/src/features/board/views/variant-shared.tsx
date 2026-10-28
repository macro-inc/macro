import { t } from '@app/lib/i18n';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import { EmptyStatePanel } from '@ui';
import { type JSX, Match, Switch } from 'solid-js';
import type { Point } from '../core/camera';
import type { BoardItem } from '../core/item';
import type { BoardMemory } from '../primitives/board-memory';
import type { BoardScene } from '../primitives/board-scene';
import type { BoardStage } from '../primitives/board-stage';

/** What every variant receives from the board view. */
export type VariantProps = {
  scene: BoardScene;
  memory: BoardMemory;
  onOpen: (key: string) => void;
  /** Closes a node until something newer than `activityAt` happens in it. */
  onDismiss: (key: string, activityAt: number) => void;
  onRetry: () => void;
};

export function itemLabel(item: BoardItem, moved: boolean): string {
  const label =
    item.unreadCount > 0
      ? t('board.itemLabelUnread', {
          title: item.title,
          count: item.unreadCount,
        })
      : item.title;
  return moved ? t('board.itemLabelMoved', { label }) : label;
}

/**
 * Handlers that make a node movable and openable on a stage. `origin` is
 * the point the variant positions the node by (its corner or center).
 */
export function nodeBindings(
  stage: BoardStage,
  node: () => { key: string; lastActivityAt: number },
  origin: () => Point | undefined,
  props: Pick<VariantProps, 'onOpen' | 'onDismiss'>
) {
  const key = () => node().key;
  return {
    dragging: () => stage.drag.isDragging(key()),
    onPointerDown: (event: PointerEvent) => {
      const at = origin();
      if (at) stage.drag.start(event, key(), at);
    },
    onOpen: () => {
      if (!stage.drag.consumeClick()) props.onOpen(key());
    },
    onKeyDown: (event: KeyboardEvent) => {
      const at = origin();
      if (at) stage.drag.nudge(event, key(), at);
    },
    onDismiss: () => props.onDismiss(key(), node().lastActivityAt),
  };
}

/** Loading, failure and all-caught-up states, drawn over an empty board. */
export function BoardStatus(props: {
  scene: BoardScene;
  memory: BoardMemory;
  onRetry: () => void;
}) {
  return (
    <Switch>
      <Match when={props.scene.view().t === 'loading'}>
        <StatusOverlay>
          <div
            role="status"
            aria-label={t('board.loading')}
            class="flex size-full items-center justify-center"
          >
            <LoadingSpinner />
          </div>
        </StatusOverlay>
      </Match>
      <Match when={props.scene.view().t === 'error'}>
        <StatusOverlay>
          <EmptyStatePanel
            centered
            title={t('board.error')}
            primaryAction={{ label: t('board.retry'), onClick: props.onRetry }}
          />
        </StatusOverlay>
      </Match>
      <Match when={props.scene.view().t === 'empty'}>
        <StatusOverlay>
          <EmptyStatePanel
            centered
            title={t('board.emptyTitle')}
            description={t('board.emptyDescription')}
            primaryAction={
              props.scene.hiddenCount() > 0
                ? {
                    label: t('board.showSettledCount', {
                      count: props.scene.hiddenCount(),
                    }),
                    onClick: () => props.memory.setShowSettled(true),
                  }
                : undefined
            }
          />
        </StatusOverlay>
      </Match>
    </Switch>
  );
}

/** Covers the board so its pan and zoom leave the state's controls alone. */
function StatusOverlay(props: { children: JSX.Element }) {
  return (
    <div data-board-overlay="" class="absolute inset-0 z-10">
      {props.children}
    </div>
  );
}
