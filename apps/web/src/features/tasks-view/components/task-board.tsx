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
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  type JSX,
  on,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import type {
  TaskBoardColumn,
  TaskBoardMove,
  TaskBoardTask,
} from '../core/task-board';
import { taskBoardRevealIndices } from '../core/task-board-reveal';

const END_COLUMN_KEY = -1;

type Reveal = { id: string; toLane: string; scope?: string };

type BoardContextValue = {
  columns: Accessor<readonly TaskBoardColumn[]>;
  animationScope: Accessor<string | undefined>;
  reveal: Accessor<Reveal | undefined>;
  onRevealed(request: Reveal): void;
  attachViewport(element: HTMLDivElement): () => void;
};

type ColumnContextValue = {
  column: Accessor<TaskBoardColumn>;
  headerId: string;
  snapshot?: KanbanScrollSnapshot;
  onSnapshot(snapshot: KanbanScrollSnapshot): void;
};

const BoardContext = createContext<BoardContextValue>();
const ColumnContext = createContext<ColumnContextValue>();
const ColumnHoverContext = createContext<Accessor<boolean>>();

function useBoardContext() {
  const context = useContext(BoardContext);
  if (!context) throw new Error('TaskBoard.Root is required');
  return context;
}

function useColumnContext() {
  const context = useContext(ColumnContext);
  if (!context) throw new Error('TaskBoard.Columns is required');
  return context;
}

/** Owns drag motion and reveal requests, without task queries or property rendering. */
function Root(props: {
  columns: readonly TaskBoardColumn[];
  animationScope?: string;
  targetActivationSpeed?: number;
  canMove(move: TaskBoardMove): boolean;
  onMove(move: TaskBoardMove): Promise<boolean>;
  ref?: (element: HTMLDivElement) => void;
  children: JSX.Element;
}) {
  let viewport: HTMLDivElement | undefined;
  let revealGeneration = 0;
  const [reveal, setReveal] = createSignal<Reveal>();
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
    ) {
      return;
    }

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

  const context: BoardContextValue = {
    columns: () => props.columns,
    animationScope: () => props.animationScope,
    reveal,
    onRevealed: (request) =>
      setReveal((current) => (current === request ? undefined : current)),
    attachViewport: (element) => {
      viewport?.removeEventListener('mousedown', startHover);
      viewport = element;
      viewport.addEventListener('mousedown', startHover);
      props.ref?.(element);

      return () => {
        if (viewport !== element) return;
        element.removeEventListener('mousedown', startHover);
        viewport = undefined;
        revealGeneration += 1;
        setReveal(undefined);
        endHover();
        motion.cancel();
      };
    },
  };

  return (
    <BoardContext.Provider value={context}>
      <Kanban
        getViewport={() => viewport}
        canDropCard={props.canMove}
        mode="cross-column"
        targetActivationSpeed={props.targetActivationSpeed ?? 600}
        onDrop={(drop, visual) => {
          if (!props.canMove(drop)) {
            return;
          }

          const sourceParentKey = JSON.stringify(['column', drop.fromLane]);
          const finish = motion.begin(
            drop.id,
            JSON.stringify(['column', drop.toLane]),
            visual
              ? {
                  ...visual,
                  key: JSON.stringify([sourceParentKey, drop.id]),
                  parentKey: sourceParentKey,
                }
              : undefined
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
        {props.children}
      </Kanban>
    </BoardContext.Provider>
  );
}

/** Virtualizes columns and an optional final column supplied by the caller. */
function Columns(props: {
  children(column: Accessor<TaskBoardColumn>): JSX.Element;
  endColumn?: () => JSX.Element;
}) {
  const board = useBoardContext();
  let viewport: HTMLDivElement | undefined;
  let releaseViewport: (() => void) | undefined;
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
  onCleanup(() => {
    wheel.reset();
    releaseViewport?.();
  });
  createEffect(on(board.animationScope, wheel.reset));
  const columnsById = createMemo(
    () => new Map(board.columns().map((column) => [column.id, column]))
  );
  const virtualizer = createKanbanVirtualizer({
    direction: 'horizontal',
    keys: () => {
      const keys: (string | number)[] = board
        .columns()
        .map((column) => column.id);

      if (props.endColumn) {
        keys.push(END_COLUMN_KEY);
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
    on(board.reveal, (request) => {
      if (!request || request.scope !== board.animationScope()) {
        return;
      }

      const indices = taskBoardRevealIndices(
        board.columns(),
        request.toLane,
        request.id
      );
      if (indices) {
        virtualizer.scrollToIndex(indices.column, { align: 'auto' });
      }
    })
  );

  return (
    <Scroll
      orientation="horizontal"
      scrollbars="horizontal"
      autoHide={false}
      scrollRef={(element) => {
        releaseViewport?.();
        viewport = element;
        releaseViewport = board.attachViewport(element);
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
                <Show when={key === END_COLUMN_KEY}>{props.endColumn?.()}</Show>
                <Show when={columnsById().get(String(key))}>
                  {(column) => {
                    // Cleanup runs after Show invalidates its column accessor.
                    const columnId = column().id;
                    const context: ColumnContextValue = {
                      column,
                      headerId: createUniqueId(),
                      snapshot: scrollSnapshots.get(columnId),
                      onSnapshot: (snapshot) => {
                        scrollSnapshots.set(columnId, snapshot);
                      },
                    };

                    return (
                      <ColumnContext.Provider value={context}>
                        {props.children(column)}
                      </ColumnContext.Provider>
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

function Column(props: { children: JSX.Element }) {
  const { column, headerId } = useColumnContext();
  const [hovered, setHovered] = createSignal(false);

  return (
    <ColumnHoverContext.Provider value={hovered}>
      <KanbanLane
        id={column().id}
        label={column().label}
        aria-labelledby={headerId}
        class="max-h-full min-h-0 w-84"
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        {props.children}
      </KanbanLane>
    </ColumnHoverContext.Provider>
  );
}

function Header(props: { children: JSX.Element }) {
  const { headerId } = useColumnContext();

  return (
    <header
      id={headerId}
      class="flex min-w-0 shrink-0 items-center gap-2 px-2 pt-1 pb-2"
    >
      {props.children}
    </header>
  );
}

function DropOverlay(props: { children: JSX.Element }) {
  const { column } = useColumnContext();
  const target = useKanbanDropTarget();

  return (
    <Show when={target()?.kind === 'card' && target()?.toLane === column().id}>
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-lg bg-surface-0/95 p-4 text-center text-sm font-medium text-ink"
      >
        {props.children}
      </div>
    </Show>
  );
}

/** Owns the vertical viewport and row measurements; card content stays with the caller. */
function Cards(props: {
  children(task: Accessor<TaskBoardTask>): JSX.Element;
  empty?: JSX.Element;
  footer?: JSX.Element;
}) {
  const board = useBoardContext();
  const lane = useColumnContext();
  const hovered = useContext(ColumnHoverContext);
  if (!hovered) throw new Error('TaskBoard.Column is required');
  let viewport: HTMLDivElement | undefined;
  const rows = () => lane.column().tasks;
  const rowsById = createMemo(
    () => new Map(rows().map((task) => [task.id, task]))
  );
  const virtualizer = createKanbanVirtualizer({
    direction: 'vertical',
    laneId: () => lane.column().id,
    keys: () => rows().map((task) => task.id),
    getScrollElement: () => viewport,
    estimateSize: 104,
    gap: 12,
    overscan: 3,
    snapshot: lane.snapshot,
  });
  const virtualItems = createMemo(() =>
    virtualizer.getVirtualItems().map((item) => ({ ...item }))
  );

  createEffect(() => {
    const request = board.reveal();
    // Wait for the horizontal lane and vertical viewport to mount.
    const mountedRows = virtualItems();
    if (
      !request ||
      request.scope !== board.animationScope() ||
      request.toLane !== lane.column().id ||
      !viewport?.isConnected ||
      mountedRows.length === 0
    ) {
      return;
    }

    const row = rows().findIndex((task) => task.id === request.id);
    if (row < 0) return;
    virtualizer.scrollToIndex(row, { align: 'auto' });
    board.onRevealed(request);
  });

  onCleanup(() => {
    lane.onSnapshot({
      offset: viewport?.scrollTop ?? 0,
      measurements: virtualizer.takeSnapshot(),
    });
  });

  return (
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
        'aria-label': `${lane.column().label} tasks`,
        'aria-labelledby': lane.headerId,
        tabindex: 0,
        'data-task-board-scroll': lane.column().id,
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
                  // Measure after content mounts, and again if a stable key moves.
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
                  {(task) => props.children(task)}
                </Show>
              </div>
            );
          }}
        </Key>
      </div>
      <Show when={rows().length === 0}>{props.empty}</Show>
      {props.footer}
    </Scroll>
  );
}

function Card(props: {
  task: TaskBoardTask;
  canDrag: boolean;
  pending: boolean;
  onOpen(task: TaskBoardTask, event: MouseEvent): void;
  children: JSX.Element;
}) {
  const { column } = useColumnContext();

  return (
    <KanbanCard
      id={props.task.id}
      laneId={column().id}
      canDrag={props.canDrag}
      pending={props.pending}
      onClick={(event) => {
        if (event.target.closest('[data-kanban-no-drag], button')) {
          return;
        }

        props.onOpen(props.task, event);
      }}
    >
      {props.children}
    </KanbanCard>
  );
}

function HiddenColumns(props: {
  count: number;
  partial: boolean;
  onReveal(): void;
}) {
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
          props.partial ? `At least ${props.count} hidden columns` : undefined
        }
      >
        {props.count}
        {props.partial ? '+' : ''} hidden
      </h2>
      <Button size="sm" variant="outline" onClick={props.onReveal}>
        Reveal hidden columns
      </Button>
    </section>
  );
}

export const TaskBoard = {
  Root,
  Columns,
  Column,
  Header,
  DropOverlay,
  Cards,
  Card,
  HiddenColumns,
};
