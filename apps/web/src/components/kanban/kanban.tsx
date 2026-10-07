import {
  type CollisionDetector,
  createDraggable,
  createDroppable,
  DragDropProvider,
  DragOverlay,
} from '@thisbeyond/solid-dnd';
import { cn } from '@ui';
import {
  createContext,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import { cloneDragPreview } from '../drag-drop/drag-preview';
import { DragSessionSensors } from '../drag-drop/drag-session-sensors';
import { findKanbanCollision, LANE_INSERTION_INSET } from './kanban-collision';
import { createKanbanPointerIntent } from './kanban-pointer-intent';
import type { KanbanCrossColumnDrop, KanbanDrop } from './kanban-types';

export type { KanbanCrossColumnDrop, KanbanDrop } from './kanban-types';

type KanbanProps = {
  children: JSX.Element;
  getViewport?: () => HTMLElement | undefined;
  /** In cross-column mode, report pointer placement instead of host sorting. */
  pointerPlacement?: boolean;
  /** Gate entry to new columns above this pointer speed (pixels/second). */
  targetActivationSpeed?: number;
} & (
  | {
      mode?: 'ordered';
      onDrop: (drop: KanbanDrop) => void;
      canDropCard?: (drop: Extract<KanbanDrop, { kind: 'card' }>) => boolean;
    }
  | {
      mode: 'cross-column';
      onDrop: (drop: KanbanCrossColumnDrop) => void;
      canDropCard?: (drop: KanbanCrossColumnDrop) => boolean;
    }
);

const DragContext = createContext<{
  suppressClick: () => boolean;
  start: (event: MouseEvent) => void;
  target: () => KanbanDrop | undefined;
  crossColumn: () => boolean;
}>();

const HandleContext = createContext<{
  activators: ReturnType<typeof createDraggable>['dragActivators'];
  disabled: boolean;
}>();

/** Query-free drag surface. Its preview is a snapshot of the original at its exact size. */
export function Kanban(props: KanbanProps) {
  const [preview, setPreview] = createSignal<HTMLElement>();
  const [target, setTarget] = createSignal<KanbanDrop>();

  let origin: { x: number; y: number } | undefined;
  let suppressClick = false;
  let cancelled = false;
  let reevaluate: (() => void) | undefined;
  const intent = createKanbanPointerIntent({
    speed: () => props.targetActivationSpeed,
    settled: () => reevaluate?.(),
  });
  const clearIntent = () => {
    intent.reset();
    reevaluate = undefined;
  };
  onCleanup(clearIntent);

  const canDropCard = (drop: Extract<KanbanDrop, { kind: 'card' }>) => {
    if (props.mode !== 'cross-column') {
      return props.canDropCard?.(drop) ?? true;
    }

    if (drop.fromLane === drop.toLane) {
      return false;
    }

    return (
      props.canDropCard?.({
        kind: 'card',
        id: drop.id,
        fromLane: drop.fromLane,
        toLane: drop.toLane,
        ...(props.pointerPlacement ? { beforeId: drop.beforeId } : {}),
      }) ?? true
    );
  };

  const releaseClick = () => {
    setTimeout(() => {
      suppressClick = false;
    }, 0);
  };

  const rejectCollision = () => {
    setTarget(undefined);
    return null;
  };

  const collisionDetector: CollisionDetector = (draggable, droppables) => {
    if (!origin || cancelled) {
      return rejectCollision();
    }

    const pointer = {
      x: origin.x + draggable.transform.x,
      y: origin.y + draggable.transform.y,
    };
    const resolve = () => {
      const settled = intent.update(pointer);
      const collision = findKanbanCollision(draggable, droppables, pointer, {
        mode: props.mode ?? 'ordered',
        viewport: props.getViewport?.()?.getBoundingClientRect(),
        pointerPlacement: props.pointerPlacement,
      });

      if (!collision) {
        return rejectCollision();
      }

      const { drop, droppable } = collision;

      if (drop.kind === 'card' && !canDropCard(drop)) {
        return rejectCollision();
      }

      const active = target();
      const sameColumn =
        active?.id === drop.id && active.toLane === drop.toLane;

      if (!settled && !sameColumn) {
        return rejectCollision();
      }
      setTarget(drop);
      return droppable;
    };
    reevaluate = resolve;

    return resolve();
  };

  const handleDragEnd = () => {
    const drop = target();
    clearIntent();

    try {
      if (cancelled) {
        return;
      }

      releaseClick();

      if (!drop) {
        return;
      }

      if (drop.kind === 'card' && !canDropCard(drop)) {
        return;
      }

      if (props.mode !== 'cross-column') {
        props.onDrop(drop);
        return;
      }

      if (drop.kind !== 'card') {
        return;
      }

      // Let the host capture the placeholder layout before removing it.
      props.onDrop({
        kind: 'card',
        id: drop.id,
        fromLane: drop.fromLane,
        toLane: drop.toLane,
        ...(props.pointerPlacement ? { beforeId: drop.beforeId } : {}),
      });
    } finally {
      origin = undefined;
      setTarget(undefined);
      setPreview(undefined);
    }
  };

  onCleanup(() => document.removeEventListener('mouseup', releaseClick));

  return (
    <DragDropProvider
      collisionDetector={collisionDetector}
      onDragStart={({ draggable }) => {
        suppressClick = true;
        setPreview(cloneDragPreview(draggable.node, 'data-kanban-preview'));
      }}
      onDragEnd={handleDragEnd}
    >
      <DragSessionSensors
        getViewport={() => props.getViewport?.()}
        axis="both"
        activationDistance={props.mode === 'cross-column' ? 10 : undefined}
        nestedScroll={
          props.mode === 'cross-column'
            ? {
                viewportSelector: '[data-kanban-scroll]',
                horizontalOutside: true,
              }
            : undefined
        }
        onCancel={() => {
          cancelled = true;
          clearIntent();
          setTarget(undefined);
          document.addEventListener('mouseup', releaseClick, { once: true });
        }}
      />
      <DragContext.Provider
        value={{
          suppressClick: () => suppressClick,
          target,
          crossColumn: () => props.mode === 'cross-column',
          start: (event) => {
            origin = { x: event.clientX, y: event.clientY };
            clearIntent();
            intent.reset(origin);
            cancelled = false;
            setTarget(undefined);
          },
        }}
      >
        {props.children}
      </DragContext.Provider>
      <DragOverlay
        class="pointer-events-none select-none"
        style={{ 'z-index': 1000 }}
      >
        {preview()}
      </DragOverlay>
    </DragDropProvider>
  );
}

/** Read the validated destination without coupling consumers to drag sensor state. */
export function useKanbanDropTarget() {
  const drag = useContext(DragContext);
  return () => drag?.target();
}
/** Place at the end of a relatively positioned card list; cards provide their own leading marker. */
export function KanbanCardInsertion(props: {
  laneId: string;
  beforeId?: string;
}) {
  const drag = useContext(DragContext);

  const active = () => {
    if (drag?.crossColumn()) {
      return false;
    }

    const target = drag?.target();

    if (target?.kind !== 'card' || target.toLane !== props.laneId) {
      return false;
    }

    return target.beforeId === props.beforeId;
  };

  return (
    <Show when={active()}>
      <span
        aria-hidden="true"
        data-kanban-insertion="card"
        data-lane-id={props.laneId}
        data-before-row-id={props.beforeId}
        class={cn(
          'pointer-events-none absolute -inset-x-2 z-10 h-0.5 rounded-full bg-accent',
          props.beforeId ? '-top-1.5' : '-bottom-1.5'
        )}
      >
        <span class="absolute top-1/2 left-0 size-1 -translate-y-1/2 rounded-full bg-accent" />
        <span class="absolute top-1/2 right-0 size-1 -translate-y-1/2 rounded-full bg-accent" />
      </span>
    </Show>
  );
}

export function KanbanLane(props: {
  id: string;
  label: string;
  canReorder?: boolean;
  class?: string;
  onKeyDown?: JSX.EventHandlerUnion<HTMLElement, KeyboardEvent>;
  onPointerEnter?: JSX.EventHandlerUnion<HTMLElement, PointerEvent>;
  onPointerLeave?: JSX.EventHandlerUnion<HTMLElement, PointerEvent>;
  children: JSX.Element;
}) {
  const drag = useContext(DragContext);

  const edge = () => {
    const target = drag?.target();

    if (target?.kind !== 'lane' || target.toLane !== props.id) {
      return undefined;
    }

    return target.edge;
  };

  const highlighted = () => {
    if (!drag?.crossColumn()) {
      return false;
    }

    const target = drag.target();

    return target?.kind === 'card' && target.toLane === props.id;
  };

  const canReorder = () => props.canReorder && !drag?.crossColumn();

  const draggable = createDraggable(`lane:${props.id}`, {
    kind: 'lane',
    itemId: props.id,
    laneId: props.id,
  });
  const droppable = createDroppable(`lane:${props.id}`, { laneId: props.id });

  return (
    <HandleContext.Provider
      value={{
        get activators() {
          return draggable.dragActivators;
        },
        get disabled() {
          return !canReorder();
        },
      }}
    >
      <section
        ref={(node) => {
          draggable.ref(node);
          droppable.ref(node);
        }}
        class={cn(
          'relative flex w-72 shrink-0 flex-col rounded-xl border border-transparent bg-surface-1 p-2 transition-colors',
          draggable.isActiveDraggable && 'opacity-35',
          highlighted() && 'ring-2 ring-accent',
          props.class
        )}
        data-kanban-drop-target={highlighted() ? 'column' : undefined}
        aria-label={props.label}
        data-kanban-lane={props.id}
        onKeyDown={props.onKeyDown}
        onPointerEnter={props.onPointerEnter}
        onPointerLeave={props.onPointerLeave}
        onMouseDown={(event) => {
          if (!canReorder() || event.target !== event.currentTarget) {
            return;
          }

          drag?.start(event);
          draggable.dragActivators.onmousedown?.(event);
        }}
      >
        <Show when={edge()}>
          <span
            aria-hidden="true"
            data-kanban-insertion="lane"
            data-edge={edge()}
            class="pointer-events-none absolute inset-y-0 z-10 w-0.5 rounded-full bg-accent"
            style={{
              left:
                edge() === 'before' ? `${-LANE_INSERTION_INSET}px` : undefined,
              right:
                edge() === 'after' ? `${-LANE_INSERTION_INSET}px` : undefined,
            }}
          />
        </Show>
        {props.children}
      </section>
    </HandleContext.Provider>
  );
}

export function KanbanCard(props: {
  id: string;
  laneId: string;
  canDrag: boolean;
  pending?: boolean;
  onClick?: JSX.EventHandler<HTMLElement, MouseEvent>;
  children: JSX.Element;
}) {
  const drag = useContext(DragContext);
  const draggable = createDraggable(`card:${props.laneId}:${props.id}`, {
    kind: 'card',
    itemId: props.id,
    laneId: props.laneId,
  });

  return (
    <HandleContext.Provider
      value={{
        get activators() {
          return draggable.dragActivators;
        },
        get disabled() {
          return !props.canDrag;
        },
      }}
    >
      <article
        ref={draggable.ref}
        class={cn(
          'group relative rounded-lg border border-edge-muted bg-surface-3 shadow-sm transition-shadow hover:border-edge hover:shadow-md',
          draggable.isActiveDraggable && 'opacity-35',
          props.pending && 'ring-1 ring-ink/20'
        )}
        onMouseDown={(event) => {
          if (!event.currentTarget.contains(event.target)) {
            return;
          }

          if (!props.canDrag || event.target.closest('[data-kanban-no-drag]')) {
            return;
          }

          drag?.start(event);
          draggable.dragActivators.onmousedown?.(event);
        }}
        onDragStart={(event) => {
          if (props.canDrag) {
            event.preventDefault();
          }
        }}
        onClick={(event) => {
          if (!event.currentTarget.contains(event.target)) {
            return;
          }

          if (drag?.suppressClick()) {
            return;
          }

          props.onClick?.(event);
        }}
        on:click={{
          handleEvent(event: MouseEvent) {
            if (!drag?.suppressClick()) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
          },
          capture: true,
        }}
        data-row-id={props.id}
        data-kanban-card={props.id}
        aria-busy={props.pending}
      >
        <KanbanCardInsertion laneId={props.laneId} beforeId={props.id} />
        {props.children}
      </article>
    </HandleContext.Provider>
  );
}

/** Use within a lane or card. Handles never add a second visual wrapper. */
export function KanbanHandle(props: {
  children: JSX.Element;
  label: string;
  class?: string;
  onKeyDown?: JSX.EventHandlerUnion<HTMLDivElement, KeyboardEvent>;
}) {
  const drag = useContext(HandleContext);
  const board = useContext(DragContext);

  if (!drag) {
    throw new Error('KanbanHandle requires a KanbanLane or KanbanCard');
  }

  return (
    <div
      class={props.class}
      onMouseDown={(event) => {
        if (drag.disabled || event.target.closest('[data-kanban-no-drag]')) {
          return;
        }

        event.stopPropagation();
        board?.start(event);
        drag.activators.onmousedown?.(event);
      }}
      aria-label={props.label}
      onKeyDown={props.onKeyDown}
      tabindex={props.onKeyDown ? 0 : undefined}
      role={props.onKeyDown ? 'button' : undefined}
      style={{ 'touch-action': drag.disabled ? undefined : 'none' }}
    >
      {props.children}
    </div>
  );
}
