import {
  Kanban,
  KanbanCard,
  KanbanLane,
  useKanbanDropTarget,
} from '@app/components/kanban/kanban';
import {
  createKanbanAnimation,
  type KanbanAnimationItem,
} from '@app/components/kanban/kanban-animation';
import {
  createKanbanVirtualizer,
  type KanbanScrollSnapshot,
} from '@app/components/kanban/kanban-virtualizer';
import { createKanbanWheelScroll } from '@app/components/kanban/kanban-wheel-scroll';
import EmptyStateNoFilterMatchGraphic from '@design/empty-state-no-filter-match.svg';
import { Key } from '@solid-primitives/keyed';
import { Button } from '@ui/components/Button';
import { Scroll } from '@ui/components/Scroll';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import type {
  TaskBoardColumn,
  TaskBoardMove,
  TaskBoardTask,
} from '../core/task-board';
import { taskBoardRevealIndices } from '../core/task-board-reveal';

const HIDDEN_COLUMN_KEY = -1;

export type TaskBoardPropertySlot = (
  task: Accessor<TaskBoardTask>,
  readOnly: Accessor<boolean>
) => JSX.Element;

export type TaskBoardProps = {
  columns: readonly TaskBoardColumn[];
  sortLabel: string;
  animationScope?: string;
  targetActivationSpeed?: number;
  hiddenColumnCount: number;
  hiddenColumnCountIsPartial: boolean;
  onRevealHiddenColumns(): void;
  ref?: (element: HTMLDivElement) => void;
  canEdit(id: string): boolean;
  canMove(move: TaskBoardMove): boolean;
  pending(id: string): boolean;
  onMove(move: TaskBoardMove): Promise<boolean>;
  onOpen(task: TaskBoardTask, event: MouseEvent): void;
  onLoadMore(columnId: string): void;
  renderColumnIcon?: (column: Accessor<TaskBoardColumn>) => JSX.Element;
  renderLeadingTitleProperty?: TaskBoardPropertySlot;
  renderTitleProperty?: TaskBoardPropertySlot;
  renderProperties?: TaskBoardPropertySlot;
};

/** Presentation and interaction only. Task queries, permissions, and writes belong to the host. */
export function TaskBoard(props: TaskBoardProps) {
  let viewport: HTMLDivElement | undefined;
  let revealGeneration = 0;
  const [reveal, setReveal] = createSignal<{
    id: string;
    toLane: string;
    scope?: string;
  }>();
  const motion = createKanbanAnimation({
    viewport: () => viewport,
    items: () => {
      if (!viewport) {
        return [];
      }

      const items: KanbanAnimationItem[] = [];

      for (const layout of viewport.querySelectorAll<HTMLElement>(
        '[data-task-board-column]'
      )) {
        const element = layout.firstElementChild;

        if (!(element instanceof HTMLElement)) {
          continue;
        }

        const key = JSON.stringify(['column', layout.dataset.taskBoardColumn]);
        items.push({ key, element, layout });

        for (const card of element.querySelectorAll<HTMLElement>(
          '[data-kanban-card]'
        )) {
          const row = card.parentElement;

          if (!row) {
            continue;
          }

          items.push({
            key: JSON.stringify([key, card.dataset.kanbanCard]),
            identity: card.dataset.kanbanCard,
            parentKey: key,
            element: card,
            layout: row,
          });
        }
      }

      return items;
    },
  });

  let finishHover: (() => void) | undefined;
  const endHover = () => {
    finishHover?.();
    finishHover = undefined;
    document.removeEventListener('mouseup', endHover);
  };
  const startHover = (event: MouseEvent) => {
    if (
      !(event.target instanceof Element) ||
      !event.target.closest('[data-kanban-card]')
    )
      return;
    endHover();
    finishHover = motion.beginHover();
    document.addEventListener('mouseup', endHover);
  };

  createEffect(
    on(
      () => props.animationScope,
      () => {
        revealGeneration += 1;
        setReveal(undefined);
        motion.cancel();
      }
    )
  );
  onCleanup(() => {
    viewport?.removeEventListener('mousedown', startHover);
    endHover();
    motion.cancel();
  });

  return (
    <Kanban
      getViewport={() => viewport}
      canDropCard={props.canMove}
      mode="cross-column"
      targetActivationSpeed={props.targetActivationSpeed ?? 600}
      onDrop={(drop) => {
        if (!props.canMove(drop)) {
          return;
        }

        const finish = motion.begin(
          drop.id,
          JSON.stringify(['column', drop.toLane])
        );
        const scope = props.animationScope;
        const generation = ++revealGeneration;
        setReveal(undefined);
        const saveAndReveal = async () => {
          try {
            const moved = await props.onMove(drop);
            if (
              moved &&
              generation === revealGeneration &&
              props.animationScope === scope
            ) {
              setReveal({ id: drop.id, toLane: drop.toLane, scope });
            }
          } finally {
            finish();
          }
        };
        void saveAndReveal();
      }}
    >
      <TaskBoardViewport
        {...props}
        reveal={reveal()}
        onRevealed={(request) =>
          setReveal((current) => (current === request ? undefined : current))
        }
        ref={(element) => {
          viewport?.removeEventListener('mousedown', startHover);
          viewport = element;
          viewport.addEventListener('mousedown', startHover);
          props.ref?.(element);
        }}
      />
    </Kanban>
  );
}

type Reveal = { id: string; toLane: string; scope?: string };

function TaskBoardViewport(
  props: TaskBoardProps & { reveal?: Reveal; onRevealed(request: Reveal): void }
) {
  let viewport: HTMLDivElement | undefined;
  const scrollSnapshots = new Map<string, KanbanScrollSnapshot>();
  const wheel = createKanbanWheelScroll({
    viewport: () => viewport,
    verticalViewport: (target) =>
      target.closest<HTMLElement>('[data-task-board-scroll]') ??
      target
        .closest('[data-kanban-lane]')
        ?.querySelector<HTMLElement>('[data-task-board-scroll]') ??
      null,
  });
  onCleanup(wheel.reset);
  createEffect(on(() => props.animationScope, wheel.reset));
  const columnsById = createMemo(
    () => new Map(props.columns.map((column) => [column.id, column]))
  );
  const virtualizer = createKanbanVirtualizer({
    direction: 'horizontal',
    keys: () => {
      const keys: (string | number)[] = props.columns.map(
        (column) => column.id
      );

      if (props.hiddenColumnCount > 0) {
        keys.push(HIDDEN_COLUMN_KEY);
      }

      return keys;
    },
    getScrollElement: () => viewport,
    estimateSize: 336,
    gap: 16,
    overscan: 1,
    paddingStart: 16,
    paddingEnd: 16,
  });
  const virtualItems = createMemo(() =>
    virtualizer.getVirtualItems().map((item) => ({ ...item }))
  );
  createEffect(
    on(
      () => props.reveal,
      (request) => {
        if (!request || request.scope !== props.animationScope) return;
        const indices = taskBoardRevealIndices(
          props.columns,
          request.toLane,
          request.id
        );
        if (indices)
          virtualizer.scrollToIndex(indices.column, { align: 'auto' });
      }
    )
  );

  return (
    <Scroll
      orientation="horizontal"
      scrollbars="horizontal"
      autoHide={false}
      scrollRef={(element) => {
        viewport = element;
        props.ref?.(element);
      }}
      onWheel={wheel.onWheel}
      class="ph-no-capture min-h-0 min-w-0 w-full flex-1"
      viewportProps={{
        tabindex: -1,
        role: 'region',
        'aria-label': 'Task board',
        class: 'pt-1 pb-4 outline-none',
      }}
      contentProps={{ style: { height: '100%' } }}
    >
      <div
        class="relative h-full min-w-full"
        data-task-board-columns
        style={{ width: `${virtualizer.getTotalSize()}px` }}
      >
        <Key each={virtualItems()} by="key">
          {(item) => {
            const key = item().key;
            return (
              <div
                class="absolute top-0 h-full"
                data-task-board-column={key}
                style={{
                  left: `${item().start}px`,
                  width: `${item().size}px`,
                }}
              >
                <Show when={key === HIDDEN_COLUMN_KEY}>
                  <HiddenColumns {...props} />
                </Show>
                <Show when={columnsById().get(String(key))}>
                  {(column) => {
                    // Cleanup runs after Show invalidates its column accessor.
                    const columnId = column().id;

                    return (
                      <TaskBoardLane
                        column={column()}
                        board={props}
                        reveal={props.reveal}
                        onRevealed={props.onRevealed}
                        snapshot={scrollSnapshots.get(columnId)}
                        onSnapshot={(snapshot) => {
                          scrollSnapshots.set(columnId, snapshot);
                        }}
                      />
                    );
                  }}
                </Show>
              </div>
            );
          }}
        </Key>
      </div>
    </Scroll>
  );
}

function TaskBoardLane(props: {
  column: TaskBoardColumn;
  board: TaskBoardProps;
  reveal?: Reveal;
  onRevealed(request: Reveal): void;
  snapshot?: KanbanScrollSnapshot;
  onSnapshot(snapshot: KanbanScrollSnapshot): void;
}) {
  let viewport: HTMLDivElement | undefined;
  const column = () => props.column;
  const [hovered, setHovered] = createSignal(false);
  const target = useKanbanDropTarget();
  const rows = () => props.column.tasks;
  const rowsById = createMemo(
    () => new Map(rows().map((task) => [task.id, task]))
  );
  const virtualizer = createKanbanVirtualizer({
    direction: 'vertical',
    laneId: () => props.column.id,
    keys: () => rows().map((task) => task.id),
    getScrollElement: () => viewport,
    estimateSize: 104,
    gap: 12,
    overscan: 3,
    snapshot: props.snapshot,
  });
  const virtualItems = createMemo(() =>
    virtualizer.getVirtualItems().map((item) => ({ ...item }))
  );

  createEffect(() => {
    const request = props.reveal;
    // The horizontal virtualizer can mount this lane after the drop settles.
    // Wait until the vertical virtualizer connects to its viewport.
    const mountedRows = virtualItems();
    if (
      !request ||
      request.scope !== props.board.animationScope ||
      request.toLane !== props.column.id ||
      !viewport?.isConnected ||
      mountedRows.length === 0
    )
      return;
    const row = rows().findIndex((task) => task.id === request.id);
    if (row < 0) return;
    virtualizer.scrollToIndex(row, { align: 'center' });
    props.onRevealed(request);
  });

  const countLabel = () => {
    const loaded = props.column.tasks.length;

    if (props.column.count === undefined) {
      return `${loaded} loaded tasks`;
    }

    return `${loaded} loaded of ${props.column.count} tasks`;
  };

  onCleanup(() => {
    props.onSnapshot({
      offset: viewport?.scrollTop ?? 0,
      measurements: virtualizer.takeSnapshot(),
    });
  });

  return (
    <KanbanLane
      id={props.column.id}
      label={props.column.label}
      class="max-h-full min-h-0 w-84"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <header class="flex min-w-0 shrink-0 items-center gap-2 px-2 pt-1 pb-2">
        <span
          class="flex size-4 shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          {props.board.renderColumnIcon?.(column)}
        </span>
        <h2 class="truncate text-sm font-medium" title={props.column.label}>
          {props.column.label}
        </h2>
        <span
          class="ml-auto shrink-0 text-xs text-ink-muted"
          aria-label={countLabel()}
        >
          {props.column.count ?? props.column.tasks.length}
        </span>
      </header>
      <Show
        when={target()?.kind === 'card' && target()?.toLane === props.column.id}
      >
        <div
          aria-hidden="true"
          class="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-lg bg-accent/10 text-sm font-medium text-ink"
        >
          Board sorted by {props.board.sortLabel}
        </div>
      </Show>
      <Scroll
        orientation="vertical"
        scrollbars="vertical"
        autoHide
        autoHideDelay={200}
        revealOn="hover"
        hovered={hovered()}
        fill={false}
        scrollRef={(element) => {
          viewport = element;
        }}
        class="min-h-0 flex-auto"
        viewportProps={{
          role: 'region',
          'aria-label': `${props.column.label} tasks`,
          tabindex: 0,
          'data-task-board-scroll': props.column.id,
          'data-kanban-scroll': '',
          style: { 'overflow-anchor': 'none' },
        }}
      >
        <div
          class="relative w-full"
          data-task-board-rows
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          <Key each={virtualItems()} by="key">
            {(item) => {
              const key = String(item().key);
              let row: HTMLDivElement | undefined;

              createEffect(
                on(
                  () => item().index,
                  () => {
                    // Measure after card content mounts, and again if a stable key moves.
                    queueMicrotask(() => {
                      if (row?.isConnected) {
                        virtualizer.measureElement(row);
                      }
                    });
                  }
                )
              );

              return (
                <div
                  ref={row}
                  data-index={item().index}
                  data-kanban-card-layout
                  class="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${item().start}px)` }}
                >
                  <Show when={rowsById().get(key)}>
                    {(task) => (
                      <TaskBoardCard
                        task={task()}
                        laneId={props.column.id}
                        board={props.board}
                      />
                    )}
                  </Show>
                </div>
              );
            }}
          </Key>
        </div>
        <Show when={rows().length === 0}>
          <p class="px-2 py-6 text-center text-xs text-ink-extra-muted">
            No matching tasks
          </p>
        </Show>
        <Show when={props.column.hasMore}>
          <div class="py-3">
            <Button
              size="sm"
              disabled={props.column.loadingMore}
              onClick={() => props.board.onLoadMore(props.column.id)}
            >
              {props.column.loadingMore ? 'Loading…' : 'Load more tasks'}
            </Button>
          </div>
        </Show>
      </Scroll>
    </KanbanLane>
  );
}

function TaskBoardCard(props: {
  task: TaskBoardTask;
  laneId: string;
  board: TaskBoardProps;
}) {
  const task = () => props.task;
  const readOnly = () =>
    !props.board.canEdit(props.task.id) || props.board.pending(props.task.id);

  return (
    <KanbanCard
      id={props.task.id}
      laneId={props.laneId}
      canDrag={!readOnly()}
      pending={props.board.pending(props.task.id)}
      onClick={(event) => {
        if (event.target.closest('[data-kanban-no-drag], button')) {
          return;
        }

        props.board.onOpen(props.task, event);
      }}
    >
      <div class="flex items-center gap-1 p-3 pb-2">
        <div data-kanban-no-drag class="flex shrink-0 items-center">
          {props.board.renderLeadingTitleProperty?.(task, readOnly)}
        </div>
        <button
          type="button"
          class="min-w-0 flex-1 break-words text-left text-sm font-medium text-ink hover:underline"
          onClick={(event) => {
            if (event.detail > 1) {
              return;
            }

            props.board.onOpen(props.task, event);
          }}
        >
          {props.task.name || 'Untitled task'}
        </button>
        <div data-kanban-no-drag class="flex shrink-0 items-center">
          {props.board.renderTitleProperty?.(task, readOnly)}
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-1 px-3 pb-3 text-xs text-ink-muted">
        <div data-kanban-no-drag class="contents">
          {props.board.renderProperties?.(task, readOnly)}
        </div>
      </div>
    </KanbanCard>
  );
}

function HiddenColumns(props: TaskBoardProps) {
  return (
    <section
      aria-label="Hidden columns"
      class="flex h-full min-h-40 w-full flex-col items-center gap-3 rounded-xl border border-dashed border-ink-extra-muted/25 p-4 pt-8 text-ink-muted"
    >
      <div aria-hidden="true" class="h-20 w-32 shrink-0 text-ink-extra-muted">
        <EmptyStateNoFilterMatchGraphic class="size-full" />
      </div>
      <h2
        class="text-sm font-medium"
        title={
          props.hiddenColumnCountIsPartial
            ? `At least ${props.hiddenColumnCount} hidden columns`
            : undefined
        }
      >
        {props.hiddenColumnCount}
        {props.hiddenColumnCountIsPartial ? '+' : ''} hidden
      </h2>
      <Button size="sm" variant="outline" onClick={props.onRevealHiddenColumns}>
        Reveal hidden columns
      </Button>
    </section>
  );
}
