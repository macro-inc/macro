import { fireAndForget } from '@core/util/fireAndForget';
import {
  type CollisionDetector,
  createDraggable,
  createDroppable,
  DragDropProvider,
  DragOverlay,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { cn, Layer } from '@ui';
import {
  createContext,
  createSignal,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { cloneDragPreview } from '../drag-drop/drag-preview';
import { DragSessionSensors } from '../drag-drop/drag-session-sensors';
import { HEADER_HEIGHT, useGantt } from './gantt-context';
import type { GanttGroupPlacement } from './gantt-group-placement';

export type GanttGroupMove = {
  id: string;
  fromGroup: string;
  toGroup: string;
};

type DragItem = {
  id: string;
  key: string | number;
  groupId: string;
  label: string;
};
type Point = { x: number; y: number };
const GroupDragContext = createContext<{
  active: () => DragItem | undefined;
  target: () => string | undefined;
  canDrag: (id: string) => boolean;
  start: (origin: Point, element: HTMLElement) => void;
  /** Continue a pointer gesture another control began as a move between groups. */
  handOff: (draggableId: string, origin: Point, event: PointerEvent) => void;
  move: () => GanttGroupMove | undefined;
  placement: () => GanttGroupPlacement | undefined;
  suppressClick: () => boolean;
}>();

export const useGanttGroupDrag = () => useContext(GroupDragContext);

/** Consumers own group semantics and persistence; the chart owns only the drag gesture. */
export function GanttGroupDrag(
  props: ParentProps<{
    scope: string;
    canDrag: (id: string) => boolean;
    canDrop: (move: GanttGroupMove) => boolean;
    onMove: (move: GanttGroupMove) => Promise<void>;
    getPlacement?: (move: GanttGroupMove) => GanttGroupPlacement | undefined;
  }>
) {
  const gantt = useGantt();
  const [active, setActive] = createSignal<DragItem>();
  const [target, setTarget] = createSignal<string>();
  const [pending, setPending] = createSignal<string[]>([]);
  const [error, setError] = createSignal<string>();
  const [preview, setPreview] = createSignal<{
    element: HTMLElement;
    rect: DOMRectReadOnly;
  }>();
  let handOff: GroupDragHandOff | undefined;
  let sourceElement: HTMLElement | undefined;
  const [origin, setOrigin] = createSignal<{ x: number; y: number }>();
  let scope: string | undefined;
  let cancelled = false;
  let suppressClick = false;
  let clickTimeout: ReturnType<typeof setTimeout> | undefined;
  let alive = true;
  onCleanup(() => {
    alive = false;
    clearTimeout(clickTimeout);
    if (active()) gantt.setEditing(false);
  });

  const canDrag = (id: string) => props.canDrag(id) && !pending().includes(id);
  const request = (): GanttGroupMove | undefined => {
    const item = active();
    const group = target();
    if (!item || group === undefined || scope !== props.scope) return;
    if (item.groupId === group) return;
    const move = { id: item.id, fromGroup: item.groupId, toGroup: group };
    return canDrag(item.id) && props.canDrop(move) ? move : undefined;
  };
  const collisionDetector: CollisionDetector = (draggable, droppables) => {
    const reject = () => {
      setTarget(undefined);
      return null;
    };
    const item = active();
    const viewport = gantt.viewport();
    const point = origin();
    if (!item || !point || !viewport || cancelled || scope !== props.scope)
      return reject();
    const x = point.x + draggable.transform.x;
    const y = point.y + draggable.transform.y;
    const bounds = viewport.getBoundingClientRect();
    if (
      x < bounds.left ||
      x > bounds.right ||
      y < bounds.top + HEADER_HEIGHT ||
      y > bounds.bottom
    )
      return reject();
    const destination = droppables.find((droppable) => {
      const box = droppable.node.getBoundingClientRect();
      const group = droppable.data.groupId;
      return (
        typeof group === 'string' &&
        group !== item.groupId &&
        y >= box.top &&
        y < box.bottom &&
        canDrag(item.id) &&
        props.canDrop({ id: item.id, fromGroup: item.groupId, toGroup: group })
      );
    });
    if (!destination) return reject();
    setTarget(destination.data.groupId as string);
    return destination;
  };
  const saveMove = async (move: GanttGroupMove) => {
    const attemptScope = props.scope;
    setPending((ids) => [...ids, move.id]);
    try {
      await props.onMove(move);
    } catch {
      if (alive && attemptScope === props.scope) {
        setError('Could not move item. Try again.');
      }
    } finally {
      if (alive) setPending((ids) => ids.filter((id) => id !== move.id));
    }
  };
  const finish = () => {
    const move = request();
    if (!cancelled && move && canDrag(move.id) && props.canDrop(move)) {
      fireAndForget(saveMove(move), 'gantt-group-drag');
    }
    setActive(undefined);
    setTarget(undefined);
    setPreview(undefined);
    gantt.setEditing(false);
    clickTimeout = setTimeout(() => {
      suppressClick = false;
    }, 0);
  };

  return (
    <DragDropProvider
      collisionDetector={collisionDetector}
      onDragStart={({ draggable }) => {
        scope = props.scope;
        setActive(draggable.data.item as DragItem);
        if (sourceElement) {
          const rect = sourceElement.getBoundingClientRect();
          const viewport = gantt.viewport()?.getBoundingClientRect();
          const bar = sourceElement.hasAttribute('data-gantt-bar-body');
          const inset =
            gantt.labelWidth() ||
            (gantt.sidebar.open() ? gantt.sidebar.width() : 0);
          const left =
            bar && viewport
              ? Math.max(rect.left, viewport.left + inset)
              : rect.left;
          const right = viewport
            ? Math.min(rect.right, viewport.right)
            : rect.right;
          const copy = cloneDragPreview(
            sourceElement,
            'data-gantt-drag-preview'
          );
          const width = Math.max(1, right - left);
          copy.style.width = `${width}px`;
          const label = copy.querySelector<HTMLElement>(
            '[data-gantt-bar-label]'
          );
          if (label) {
            label.style.position = 'static';
            label.style.left = 'auto';
            label.style.width = '100%';
          }
          setPreview({
            element: copy,
            rect: new DOMRect(left, rect.top, width, rect.height),
          });
        }
        suppressClick = true;
        setError(undefined);
        gantt.setGuide(undefined);
        gantt.setEditing(true);
      }}
      onDragEnd={finish}
    >
      <DragSessionSensors
        getViewport={gantt.viewport}
        axis="both"
        activationDistance={10}
        onCancel={() => {
          cancelled = true;
        }}
      />
      <PointerHandOffSensor
        ref={(sensor) => {
          handOff = sensor;
        }}
        onCancel={() => {
          cancelled = true;
        }}
      />
      <GroupDragContext.Provider
        value={{
          active,
          target: () => request()?.toGroup,
          canDrag,
          suppressClick: () => suppressClick,
          move: request,
          placement: () => {
            const move = request();
            return move ? props.getPlacement?.(move) : undefined;
          },
          start: (origin, element) => {
            sourceElement = element;
            setOrigin(origin);
            cancelled = false;
            clearTimeout(clickTimeout);
          },
          handOff: (draggableId, origin, event) =>
            handOff?.(draggableId, origin, event),
        }}
      >
        {props.children}
      </GroupDragContext.Provider>
      <DragOverlay
        style={{
          left: `${preview()?.rect.left ?? 0}px`,
          top: `${preview()?.rect.top ?? 0}px`,
          'min-width': '0',
          'min-height': '0',
          'z-index': 100,
          'pointer-events': 'none',
        }}
      >
        <Layer depth={2}>
          <div aria-hidden="true" class="rounded-md bg-surface shadow-md">
            {preview()?.element}
          </div>
        </Layer>
      </DragOverlay>
      <Show when={error()}>
        <p
          role="alert"
          class="absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-tooltip px-3 py-2 text-xs text-ink shadow-sm"
        >
          {error()}
        </p>
      </Show>
    </DragDropProvider>
  );
}

type GroupDragHandOff = (
  draggableId: string,
  origin: Point,
  event: PointerEvent
) => void;

/**
 * Drives the drag session from a pointer gesture another control began, such
 * as a bar's press that turned out to move up or down rather than across.
 */
function PointerHandOffSensor(props: {
  ref: (handOff: GroupDragHandOff) => void;
  onCancel: () => void;
}) {
  const context = useDragDropContext();
  if (!context)
    throw new Error('PointerHandOffSensor requires DragDropProvider');
  const [state, actions] = context;
  const id = 'gantt-pointer-hand-off';
  let detach: (() => void) | undefined;
  onMount(() => actions.addSensor({ id, activators: {} }));
  onCleanup(() => {
    detach?.();
    actions.removeSensor(id);
  });
  props.ref((draggableId, origin, event) => {
    if (state.active.sensor || detach) return;
    const pointerId = event.pointerId;
    const end = (cancel: boolean) => {
      detach?.();
      if (cancel) props.onCancel();
      if (state.active.draggable) actions.dragEnd();
      actions.sensorEnd();
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      next.preventDefault();
      actions.sensorMove({ x: next.clientX, y: next.clientY });
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId === pointerId) end(false);
    };
    const cancel = () => end(true);
    const cancelOnEscape = (next: KeyboardEvent) => {
      if (next.key !== 'Escape') return;
      next.preventDefault();
      next.stopPropagation();
      end(true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', cancelOnEscape, true);
    window.addEventListener('blur', cancel);
    detach = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', cancelOnEscape, true);
      window.removeEventListener('blur', cancel);
      detach = undefined;
    };
    actions.sensorStart(id, origin);
    actions.dragStart(draggableId);
    actions.sensorMove({ x: event.clientX, y: event.clientY });
  });
  return null;
}

const DragItemContext = createContext<{
  /** Whether this item can move between groups now. */
  canMove: () => boolean;
  /** Continue a press on `element` that began at `origin` as a move between groups. */
  handOff: (origin: Point, event: PointerEvent, element: HTMLElement) => void;
}>();

/** The group move of the Gantt.DragItem a control sits in, if any. */
export const useGanttDragItem = () => useContext(DragItemContext);

/** Wrap an entity row once; both its sidebar item and bar start the same group move. */
export function GanttDragItem(props: ParentProps<DragItem>) {
  const drag = useGanttGroupDrag();
  const gantt = useGantt();
  if (!drag) return props.children;
  const draggableId = () => `gantt-item:${typeof props.key}:${props.key}`;
  const draggable = createDraggable(draggableId(), {
    get item() {
      return {
        id: props.id,
        key: props.key,
        groupId: props.groupId,
        label: props.label,
      };
    },
  });
  return (
    <div
      ref={draggable.ref}
      class={cn(
        'relative h-full',
        draggable.isActiveDraggable &&
          '[&_[data-gantt-bar-body]]:opacity-35 [&_[data-gantt-label]]:opacity-35'
      )}
      onMouseDown={(event) => {
        if (event.button !== 0 || gantt.editing() || !drag.canDrag(props.id))
          return;
        if (
          !event.target.closest(
            '[data-gantt-label] button, [data-gantt-bar-body] > button:first-of-type'
          )
        )
          return;
        if (event.target.closest('[data-gantt-no-drag]')) return;
        const element = event.target.closest<HTMLElement>(
          '[data-gantt-bar-body], [data-gantt-label] button'
        );
        if (!element) return;
        drag.start({ x: event.clientX, y: event.clientY }, element);
        draggable.dragActivators.onmousedown?.(event);
      }}
      onDragStart={(event) => event.preventDefault()}
      on:click={{
        capture: true,
        handleEvent(event: MouseEvent) {
          if (!drag.suppressClick()) return;
          event.preventDefault();
          event.stopPropagation();
        },
      }}
    >
      <DragItemContext.Provider
        value={{
          canMove: () => !gantt.editing() && drag.canDrag(props.id),
          handOff: (origin, event, element) => {
            drag.start(origin, element);
            drag.handOff(draggableId(), origin, event);
          },
        }}
      >
        {props.children}
      </DragItemContext.Provider>
    </div>
  );
}

/** Place inside each group row, including collapsed headers, to receive cross-group drops. */
export function GanttGroupDrop(props: { id: string; groupId: string }) {
  const drag = useGanttGroupDrag();
  if (!drag) return null;
  const droppable = createDroppable(`gantt-group:${props.id}`, {
    get groupId() {
      return props.groupId;
    },
  });
  return (
    <div
      ref={droppable.ref}
      aria-hidden="true"
      data-gantt-group-drop={props.groupId}
      class={cn(
        'pointer-events-none absolute inset-0 z-30',
        drag.target() === props.groupId &&
          'bg-accent/10 ring-1 ring-inset ring-accent'
      )}
    />
  );
}
