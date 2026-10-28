import { t } from '@app/lib/i18n';
import { Button } from '@ui';
import { type JSX, Match, Show, Switch } from 'solid-js';
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

export function itemLabel(item: BoardItem): string {
  return item.unreadCount > 0
    ? t('board.itemLabelUnread', {
        title: item.title,
        count: item.unreadCount,
      })
    : item.title;
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
        <StatusCard title={t('board.loading')} />
      </Match>
      <Match when={props.scene.view().t === 'error'}>
        <StatusCard title={t('board.error')}>
          <Button variant="outline" size="sm" onClick={props.onRetry}>
            {t('board.retry')}
          </Button>
        </StatusCard>
      </Match>
      <Match when={props.scene.view().t === 'empty'}>
        <StatusCard
          title={t('board.emptyTitle')}
          description={t('board.emptyDescription')}
        >
          <Show when={props.scene.hiddenCount() > 0}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => props.memory.setShowSettled(true)}
            >
              {t('board.settledHidden', {
                count: props.scene.hiddenCount(),
              })}
              {' · '}
              {t('board.showAll')}
            </Button>
          </Show>
        </StatusCard>
      </Match>
    </Switch>
  );
}

function StatusCard(props: {
  title: string;
  description?: string;
  children?: JSX.Element;
}) {
  return (
    <div
      data-board-overlay=""
      class="absolute inset-0 z-10 flex items-center justify-center p-6"
    >
      <div
        role="status"
        class="flex max-w-80 flex-col items-center gap-2 rounded-2xl border border-edge-muted bg-panel px-6 py-5 text-center shadow-sm"
      >
        <span class="text-sm font-semibold text-ink">{props.title}</span>
        {props.description && (
          <span class="text-xs text-ink-muted">{props.description}</span>
        )}
        {props.children}
      </div>
    </div>
  );
}
