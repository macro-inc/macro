import {
  type CollisionDetector,
  createDraggable,
  createDroppable,
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import {
  createContext,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import { createDragAutoScroll } from '../drag-drop/create-drag-auto-scroll';

export type KanbanDrop = {
  id: string;
  fromLane: string;
  toLane: string;
} & (
  | { kind: 'lane'; edge: 'before' | 'after' }
  | { kind: 'card'; beforeId?: string }
);

const DragContext = createContext<{
  suppressClick: () => boolean;
  start: (event: MouseEvent) => void;
  target: () => KanbanDrop | undefined;
}>();

const HandleContext = createContext<{
  activators: ReturnType<typeof createDraggable>['dragActivators'];
  disabled: boolean;
}>();

const LANE_INSERTION_INSET = 10;

/** Query-free drag surface. Its preview is a snapshot of the original at its exact size. */
export function Kanban(props: {
  children: JSX.Element;
  onDrop: (drop: KanbanDrop) => void;
  getViewport?: () => HTMLElement | undefined;
  canDropCard?: (drop: Extract<KanbanDrop, { kind: 'card' }>) => boolean;
}) {
  const [preview, setPreview] = createSignal<HTMLElement>();
  const [target, setTarget] = createSignal<KanbanDrop>();
  let origin: { x: number; y: number } | undefined;
  let suppressClick = false;
  let cancelled = false;
  const releaseClick = () =>
    setTimeout(() => {
      suppressClick = false;
    }, 0);
  onCleanup(() => document.removeEventListener('mouseup', releaseClick));
  const collisionDetector: CollisionDetector = (draggable, droppables) => {
    const reject = () => {
      setTarget(undefined);
      return null;
    };
    if (!origin || cancelled) return reject();
    const pointer = {
      x: origin.x + draggable.transform.x,
      y: origin.y + draggable.transform.y,
    };
    const viewport = props.getViewport?.()?.getBoundingClientRect();
    if (
      viewport &&
      (pointer.x < viewport.left ||
        pointer.x > viewport.right ||
        pointer.y < viewport.top ||
        pointer.y > viewport.bottom)
    )
      return reject();
    const lanes = droppables
      .map((droppable) => ({
        droppable,
        rect: droppable.node.getBoundingClientRect(),
      }))
      .sort((a, b) => a.rect.left - b.rect.left);
    if (
      !lanes.length ||
      pointer.x < lanes[0].rect.left ||
      pointer.x > lanes[lanes.length - 1].rect.right ||
      (!viewport &&
        (pointer.y < Math.min(...lanes.map((lane) => lane.rect.top)) ||
          pointer.y > Math.max(...lanes.map((lane) => lane.rect.bottom))))
    )
      return reject();
    const lane = lanes.reduce((closest, lane) =>
      Math.abs(pointer.x - (lane.rect.left + lane.rect.width / 2)) <
      Math.abs(pointer.x - (closest.rect.left + closest.rect.width / 2))
        ? lane
        : closest
    );
    const { kind, itemId: id, laneId: fromLane } = draggable.data;
    const toLane: unknown = lane.droppable.data.laneId;
    if (
      typeof id !== 'string' ||
      typeof fromLane !== 'string' ||
      typeof toLane !== 'string'
    )
      return reject();
    if (kind === 'lane') {
      if (fromLane === toLane) return reject();
      const edge =
        pointer.x < lane.rect.left + lane.rect.width / 2 ? 'before' : 'after';
      const boundary =
        edge === 'before'
          ? lane.rect.left - LANE_INSERTION_INSET
          : lane.rect.right + LANE_INSERTION_INSET;
      if (viewport && (boundary < viewport.left || boundary > viewport.right))
        return reject();
      const originalIndex = lanes.findIndex(
        (lane) => lane.droppable.data.laneId === fromLane
      );
      const remaining = lanes.filter(
        (lane) => lane.droppable.data.laneId !== fromLane
      );
      const insertionIndex =
        remaining.findIndex((lane) => lane.droppable.data.laneId === toLane) +
        (edge === 'after' ? 1 : 0);
      if (originalIndex < 0 || insertionIndex === originalIndex)
        return reject();
      setTarget({ kind, id, fromLane, toLane, edge });
    } else if (kind === 'card') {
      const cards = Array.from(
        lane.droppable.node.querySelectorAll<HTMLElement>('[data-kanban-card]')
      );
      const remaining = cards.filter((card) => card.dataset.kanbanCard !== id);
      const next = remaining.find((card) => {
        const bounds = card.getBoundingClientRect();
        return pointer.y < bounds.top + bounds.height / 2;
      });
      const insertion = next ? remaining.indexOf(next) : remaining.length;
      if (
        fromLane === toLane &&
        insertion === cards.findIndex((card) => card.dataset.kanbanCard === id)
      )
        return reject();
      const drop = {
        kind,
        id,
        fromLane,
        toLane,
        beforeId: next?.dataset.kanbanCard,
      };
      if (props.canDropCard && !props.canDropCard(drop)) return reject();
      setTarget(drop);
    } else return reject();
    return lane.droppable;
  };
  return (
    <DragDropProvider
      collisionDetector={collisionDetector}
      onDragStart={({ draggable }) => {
        suppressClick = true;
        const bounds = draggable.node.getBoundingClientRect();
        const copy = draggable.node.cloneNode(true) as HTMLElement;
        copy.removeAttribute('id');
        copy
          .querySelectorAll('[id]')
          .forEach((node) => node.removeAttribute('id'));
        copy.style.width = `${bounds.width}px`;
        copy.style.height = `${bounds.height}px`;
        copy.style.margin = '0';
        copy.style.opacity = '1';
        copy.style.transform = 'none';
        copy.style.boxSizing = 'border-box';
        copy.inert = true;
        copy.setAttribute('aria-hidden', 'true');
        copy.setAttribute('data-kanban-preview', '');
        setPreview(copy);
      }}
      onDragEnd={() => {
        const drop = target();
        setTarget(undefined);
        setPreview(undefined);
        if (!cancelled) releaseClick();
        if (drop && !cancelled) props.onDrop(drop);
      }}
    >
      <DragDropSensors />
      <DragSession
        getViewport={props.getViewport}
        onCancel={() => {
          cancelled = true;
          setTarget(undefined);
          document.addEventListener('mouseup', releaseClick, { once: true });
        }}
      />
      <DragContext.Provider
        value={{
          suppressClick: () => suppressClick,
          target,
          start: (event) => {
            origin = { x: event.clientX, y: event.clientY };
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

function DragSession(props: {
  onCancel: () => void;
  getViewport?: () => HTMLElement | undefined;
}) {
  const [state, actions] = useDragDropContext()!;
  createDragAutoScroll({
    getViewport: () => props.getViewport?.(),
    axis: 'both',
  });
  const cancel = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !state.active.draggable) return;
    event.preventDefault();
    event.stopPropagation();
    props.onCancel();
    actions.dragEnd();
  };
  const updateDrop = (event: Event) => {
    if (event.target === props.getViewport?.() && state.active.draggable)
      actions.detectCollisions();
  };
  const cancelOnBlur = () => {
    if (!state.active.draggable) return;
    props.onCancel();
    actions.dragEnd();
  };
  document.addEventListener('keydown', cancel, true);
  document.addEventListener('scroll', updateDrop, true);
  window.addEventListener('blur', cancelOnBlur);
  onCleanup(() => {
    document.removeEventListener('keydown', cancel, true);
    document.removeEventListener('scroll', updateDrop, true);
    window.removeEventListener('blur', cancelOnBlur);
  });
  return null;
}

/** Place at the end of a relatively positioned card list; cards provide their own leading marker. */
export function KanbanCardInsertion(props: {
  laneId: string;
  beforeId?: string;
}) {
  const drag = useContext(DragContext);
  const active = () => {
    const target = drag?.target();
    return (
      target?.kind === 'card' &&
      target.toLane === props.laneId &&
      target.beforeId === props.beforeId
    );
  };
  return (
    <Show when={active()}>
      <span
        aria-hidden="true"
        data-kanban-insertion="card"
        data-lane-id={props.laneId}
        data-before-row-id={props.beforeId}
        class="pointer-events-none absolute -inset-x-2 z-10 h-0.5 rounded-full bg-accent"
        classList={{
          '-top-1.5': !!props.beforeId,
          '-bottom-1.5': !props.beforeId,
        }}
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
  children: JSX.Element;
}) {
  const drag = useContext(DragContext);
  const edge = () => {
    const target = drag?.target();
    return target?.kind === 'lane' && target.toLane === props.id
      ? target.edge
      : undefined;
  };
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
          return !props.canReorder;
        },
      }}
    >
      <section
        ref={(node) => {
          draggable.ref(node);
          droppable.ref(node);
        }}
        class="relative flex w-72 shrink-0 flex-col rounded-xl border border-transparent bg-hover/50 p-2 transition-colors"
        classList={{
          'opacity-35': draggable.isActiveDraggable,
        }}
        aria-label={props.label}
        data-kanban-lane={props.id}
        onMouseDown={(event) => {
          if (props.canReorder && event.target === event.currentTarget) {
            drag?.start(event);
            draggable.dragActivators.onmousedown?.(event);
          }
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
        class="group relative rounded-lg border border-edge-muted bg-panel shadow-sm transition-shadow hover:border-edge hover:shadow-md"
        classList={{
          'opacity-35': draggable.isActiveDraggable,
          'ring-1 ring-ink/20': !!props.pending,
        }}
        onMouseDown={(event) => {
          if (props.canDrag && !event.target.closest('[data-kanban-no-drag]')) {
            drag?.start(event);
            draggable.dragActivators.onmousedown?.(event);
          }
        }}
        onDragStart={(event) => {
          if (props.canDrag) event.preventDefault();
        }}
        on:click={{
          handleEvent(event: MouseEvent) {
            if (drag?.suppressClick()) {
              event.preventDefault();
              event.stopPropagation();
            }
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
  if (!drag)
    throw new Error('KanbanHandle requires a KanbanLane or KanbanCard');
  return (
    <div
      class={props.class}
      onMouseDown={(event) => {
        if (!drag.disabled && !event.target.closest('[data-kanban-no-drag]')) {
          event.stopPropagation();
          board?.start(event);
          drag.activators.onmousedown?.(event);
        }
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
