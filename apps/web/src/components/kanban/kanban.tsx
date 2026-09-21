import {
  createDraggable,
  createDroppable,
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
} from '@thisbeyond/solid-dnd';
import { createContext, createSignal, type JSX, useContext } from 'solid-js';

export type KanbanDrop = {
  kind: 'card' | 'lane';
  id: string;
  fromLane: string;
  toLane: string;
};

const DragContext = createContext<{ suppressClick: () => boolean }>();

const HandleContext = createContext<{
  activators: ReturnType<typeof createDraggable>['dragActivators'];
  disabled: boolean;
}>();

/** Query-free drag surface. Its preview is a snapshot of the original at its exact size. */
export function Kanban(props: {
  children: JSX.Element;
  onDrop: (drop: KanbanDrop) => void;
}) {
  const [preview, setPreview] = createSignal<HTMLElement>();
  let suppressClick = false;
  return (
    <DragDropProvider
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
      onDragEnd={({ draggable, droppable }) => {
        setPreview(undefined);
        setTimeout(() => {
          suppressClick = false;
        }, 0);
        const { kind, itemId, laneId } = draggable.data;
        const target: unknown = droppable?.data.laneId;
        if (
          (kind === 'card' || kind === 'lane') &&
          typeof itemId === 'string' &&
          typeof laneId === 'string' &&
          typeof target === 'string'
        )
          props.onDrop({ kind, id: itemId, fromLane: laneId, toLane: target });
      }}
    >
      <DragDropSensors />
      <DragContext.Provider value={{ suppressClick: () => suppressClick }}>
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

export function KanbanLane(props: {
  id: string;
  label: string;
  canReorder?: boolean;
  children: JSX.Element;
}) {
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
        class="flex w-72 shrink-0 flex-col rounded-xl border border-transparent bg-hover/50 p-2 transition-colors"
        classList={{
          'border-ink/40 bg-hover': droppable.isActiveDroppable,
          'opacity-35': draggable.isActiveDraggable,
        }}
        aria-label={props.label}
        data-kanban-lane={props.id}
        onMouseDown={(event) => {
          if (props.canReorder && event.target === event.currentTarget)
            draggable.dragActivators.onmousedown?.(event);
        }}
      >
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
          return !props.canDrag || !!props.pending;
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
          if (
            props.canDrag &&
            !props.pending &&
            !event.target.closest('[data-kanban-no-drag]')
          )
            draggable.dragActivators.onmousedown?.(event);
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
        aria-busy={props.pending}
      >
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
  if (!drag)
    throw new Error('KanbanHandle requires a KanbanLane or KanbanCard');
  return (
    <div
      class={props.class}
      onMouseDown={(event) => {
        if (!drag.disabled && !event.target.closest('[data-kanban-no-drag]')) {
          event.stopPropagation();
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
