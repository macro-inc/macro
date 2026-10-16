import { Key } from '@solid-primitives/keyed';
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
import {
  Kanban,
  KanbanCard,
  KanbanCardInsertion,
  type KanbanDrop,
  type KanbanDropVisual,
  KanbanLane,
  useKanbanDropTarget,
} from './kanban';
import {
  createKanbanAnimation,
  type KanbanAnimationItem,
} from './kanban-animation';
import {
  CardActions,
  CardFields,
  CardHeader,
  ColumnCount,
  ColumnLabel,
  ColumnPlaceholder,
} from './kanban-board-content';
import type {
  KanbanBoardColumn,
  KanbanBoardControls,
} from './kanban-board-types';
import {
  createKanbanVirtualizer,
  type KanbanScrollSnapshot,
} from './kanban-virtualizer';
import { createKanbanWheelScroll } from './kanban-wheel-scroll';

const END_COLUMN_KEY = -1;

type Reveal = { toLane: string; scope?: string } & (
  | { kind: 'card'; id: string }
  | { kind: 'column' | 'footer' }
);

type BoardContextValue = {
  columns: Accessor<readonly KanbanBoardColumn[]>;
  animationScope: Accessor<string | undefined>;
  reveal: Accessor<Reveal | undefined>;
  onRevealed(request: Reveal): void;
  attachViewport(element: HTMLDivElement): () => void;
};

type ColumnContextValue = {
  column: Accessor<KanbanBoardColumn>;
  headerId: string;
  snapshot?: KanbanScrollSnapshot;
  onSnapshot(snapshot: KanbanScrollSnapshot): void;
};

const BoardContext = createContext<BoardContextValue>();
const ColumnContext = createContext<ColumnContextValue>();
const ColumnHoverContext = createContext<Accessor<boolean>>();

function useBoardContext() {
  const context = useContext(BoardContext);
  if (!context) throw new Error('KanbanBoard.Root is required');
  return context;
}

function useColumnContext() {
  const context = useContext(ColumnContext);
  if (!context) throw new Error('KanbanBoard.Columns is required');
  return context;
}

/** Shared board layout and drag lifecycle; hosts own item content and writes. */
function Root(props: {
  columns: readonly KanbanBoardColumn[];
  animationScope?: string;
  mode?: 'ordered' | 'cross-column';
  canMove?: (drop: Extract<KanbanDrop, { kind: 'card' }>) => boolean;
  onDrop(drop: KanbanDrop): void | boolean | Promise<void | boolean>;
  controlsRef?: (controls: KanbanBoardControls) => void;
  ref?: (element: HTMLDivElement) => void;
  children: JSX.Element;
}) {
  let viewport: HTMLDivElement | undefined;
  let revealGeneration = 0;
  const [reveal, setReveal] = createSignal<Reveal>();
  let disposed = false;
  props.controlsRef?.({
    revealColumn: (id) => requestReveal(id, 'column'),
    revealFooter: (id) => requestReveal(id, 'footer'),
  });
  function requestReveal(toLane: string, kind: 'column' | 'footer') {
    if (disposed) return;
    revealGeneration += 1;
    setReveal({ kind, toLane, scope: props.animationScope });
  }
  const motion = createKanbanAnimation({
    viewport: () => viewport,
    items: () => {
      if (!viewport) {
        return [];
      }

      const items: KanbanAnimationItem[] = [];

      for (const layout of viewport.querySelectorAll<HTMLElement>(
        '[data-kanban-board-column]'
      )) {
        const element = layout.firstElementChild;

        if (!(element instanceof HTMLElement)) {
          continue;
        }

        const key = JSON.stringify([
          'column',
          layout.dataset.kanbanBoardColumn,
        ]);
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
    disposed = true;
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

  const canDropCard = (drop: Extract<KanbanDrop, { kind: 'card' }>) =>
    props.canMove?.(drop) ?? true;

  function commitDrop(drop: KanbanDrop, visual?: KanbanDropVisual) {
    if (drop.kind === 'lane') {
      void props.onDrop(drop);
      return;
    }
    if (!canDropCard(drop)) return;
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
    async function saveAndReveal() {
      try {
        const moved = await props.onDrop(drop);
        if (
          moved !== false &&
          generation === revealGeneration &&
          props.animationScope === scope
        ) {
          setReveal({ kind: 'card', id: drop.id, toLane: drop.toLane, scope });
        }
      } finally {
        finish();
      }
    }
    void saveAndReveal();
  }

  const dragProps =
    props.mode === 'cross-column'
      ? {
          mode: 'cross-column' as const,
          targetActivationSpeed: 600,
          canDropCard,
          onDrop: commitDrop,
        }
      : {
          mode: 'ordered' as const,
          pointerPlacement: true,
          canDropCard,
          onDrop: commitDrop,
        };
  return (
    <BoardContext.Provider value={context}>
      <Kanban {...dragProps} getViewport={() => viewport}>
        {props.children}
      </Kanban>
    </BoardContext.Provider>
  );
}

/** Virtualizes columns and an optional final column supplied by the caller. */
function Columns(props: {
  children(column: Accessor<KanbanBoardColumn>): JSX.Element;
  endColumn?: () => JSX.Element;
  /** The board's accessible name; boards of other items name their own. */
  'aria-label'?: string;
}) {
  const board = useBoardContext();
  let viewport: HTMLDivElement | undefined;
  let releaseViewport: (() => void) | undefined;
  const scrollSnapshots = new Map<string, KanbanScrollSnapshot>();
  const wheel = createKanbanWheelScroll({
    viewport: () => viewport,
    verticalViewport: (target) =>
      target.closest<HTMLElement>('[data-kanban-board-scroll]') ??
      target
        .closest('[data-kanban-lane]')
        ?.querySelector<HTMLElement>('[data-kanban-board-scroll]') ??
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
  createEffect(() => {
    const request = board.reveal();
    const columns = board.columns();
    if (!request || request.scope !== board.animationScope()) return;
    const index = columns.findIndex((column) => column.id === request.toLane);
    if (index < 0) return;
    if (request.kind === 'card' && !columns[index].itemIds.includes(request.id))
      return;
    virtualizer.scrollToIndex(index, { align: 'auto' });
    if (request.kind === 'column') board.onRevealed(request);
  });

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
        'aria-label': props['aria-label'] ?? 'Kanban board',
        'data-kanban-board-viewport': '',
        class: 'pt-1 pb-4 outline-none',
      }}
      contentProps={{ style: { height: '100%' } }}
    >
      <div
        class="relative h-full min-w-full"
        data-kanban-board-columns
        style={{ width: `${virtualizer.getTotalSize()}px` }}
      >
        <Key each={virtualItems()} by="key">
          {(item) => {
            const key = item().key;
            return (
              <div
                class="absolute top-0 h-full"
                data-kanban-board-column={key}
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

function Column(props: {
  canReorder?: boolean;
  onKeyDown?: JSX.EventHandlerUnion<HTMLElement, KeyboardEvent>;
  children: JSX.Element;
}) {
  const { column, headerId } = useColumnContext();
  const [hovered, setHovered] = createSignal(false);

  return (
    <ColumnHoverContext.Provider value={hovered}>
      <KanbanLane
        id={column().id}
        label={column().label}
        canReorder={props.canReorder}
        onKeyDown={props.onKeyDown}
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
  children(id: string): JSX.Element;
  empty?: JSX.Element;
  footer?: JSX.Element;
  /** What the cards are, for each column's accessible name. */
  itemsLabel?: string;
}) {
  const board = useBoardContext();
  const lane = useColumnContext();
  const hovered = useContext(ColumnHoverContext);
  if (!hovered) throw new Error('KanbanBoard.Column is required');
  let viewport: HTMLDivElement | undefined;
  const rows = () => lane.column().itemIds;
  const virtualizer = createKanbanVirtualizer({
    direction: 'vertical',
    laneId: () => lane.column().id,
    keys: rows,
    getScrollElement: () => viewport,
    estimateSize: 104,
    gap: 12,
    overscan: 3,
    // Keep the before-first-card marker inside the lane's scroll clip.
    paddingStart: 8,
    snapshot: lane.snapshot,
  });
  const virtualItems = createMemo(() =>
    virtualizer.getVirtualItems().map((item) => ({ ...item }))
  );

  createEffect(() => {
    const request = board.reveal();
    const mountedRows = virtualItems();
    const scrollElement = virtualizer.scrollElement;
    if (
      !request ||
      request.scope !== board.animationScope() ||
      request.toLane !== lane.column().id ||
      !scrollElement?.isConnected
    )
      return;
    if (request.kind === 'footer') {
      queueMicrotask(() => {
        if (board.reveal() !== request || !scrollElement.isConnected) return;
        scrollElement.scrollTop = scrollElement.scrollHeight;
        board.onRevealed(request);
      });
      return;
    }
    if (request.kind !== 'card' || !mountedRows.length) return;
    const row = rows().indexOf(request.id);
    if (row < 0) return;
    virtualizer.scrollToIndex(row, { align: 'auto' });
    queueMicrotask(() => board.onRevealed(request));
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
        'aria-label': `${lane.column().label} ${props.itemsLabel ?? 'items'}`,
        'aria-labelledby': lane.headerId,
        tabindex: 0,
        'data-kanban-board-scroll': lane.column().id,
        'data-kanban-scroll': '',
        style: { 'overflow-anchor': 'none' },
      }}
    >
      <div
        class="relative w-full"
        data-kanban-board-rows
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
                data-kanban-next-id={rows()[item().index + 1]}
                class="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${item().start}px)` }}
              >
                {props.children(key)}
              </div>
            );
          }}
        </Key>
        <KanbanCardInsertion laneId={lane.column().id} />
      </div>
      <Show when={rows().length === 0}>{props.empty}</Show>
      {props.footer}
    </Scroll>
  );
}

function Card(props: {
  id: string;
  canDrag: boolean;
  pending?: boolean;
  onClick?: JSX.EventHandler<HTMLElement, MouseEvent>;
  children: JSX.Element;
}) {
  const { column } = useColumnContext();

  return (
    <KanbanCard
      id={props.id}
      laneId={column().id}
      canDrag={props.canDrag}
      pending={props.pending}
      onClick={props.onClick}
    >
      {props.children}
    </KanbanCard>
  );
}

export const KanbanBoard = {
  Root,
  Columns,
  Column,
  Header,
  ColumnLabel,
  ColumnCount,
  ColumnPlaceholder,
  CardHeader,
  CardFields,
  CardActions,
  DropOverlay,
  Cards,
  Card,
};
