import { TruncatedText } from '@core/component/FileList/TruncatedText';
import type { EntityDragData } from '@entity';
import {
  type CollisionDetector,
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { Layer } from '@ui';
import { EntityIcon, getEntityIconType } from 'core/component/EntityIcon';
import {
  type Accessor,
  createContext,
  createMemo,
  createSignal,
  type JSXElement,
  onCleanup,
  useContext,
} from 'solid-js';

type DragOperationContextValue = {
  isAltKey: Accessor<boolean>;
};

const DragOperationContext = createContext<DragOperationContextValue>();

let pointerPosition: { x: number; y: number } | undefined;

const pointerWithin: CollisionDetector = (_draggable, droppables, context) => {
  if (!pointerPosition) return null;

  const enabledDroppables = droppables.filter((droppable) => {
    const isDisabled = droppable.data.isDropTargetDisabled as
      | (() => boolean)
      | undefined;
    return !isDisabled?.();
  });

  const hits = enabledDroppables.filter((droppable) => {
    const layout = droppable.layout;
    return (
      pointerPosition !== undefined &&
      pointerPosition.x >= layout.left &&
      pointerPosition.x <= layout.right &&
      pointerPosition.y >= layout.top &&
      pointerPosition.y <= layout.bottom
    );
  });

  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];

  return hits.toSorted(
    (a, b) =>
      a.layout.width * a.layout.height - b.layout.width * b.layout.height ||
      Number(b.id === context.activeDroppableId) -
        Number(a.id === context.activeDroppableId)
  )[0];
};

export function useDragOperation() {
  const context = useContext(DragOperationContext);
  if (!context) {
    throw new Error('useDragOperation must be used within ItemDndProvider');
  }
  return context;
}

function ItemDragOverlay() {
  const [state] = useDragDropContext() ?? [];
  const activeDraggable = createMemo(() => {
    return state?.active.draggable;
  });

  const iconType = createMemo(() => {
    const data = activeDraggable()?.data as EntityDragData | undefined;
    if (!data) return 'default';
    return getEntityIconType(data);
  });

  const centeredOnPointerStyle = createMemo(() => {
    const overlay = state?.active.overlay;
    const sensor = state?.active.sensor;
    if (!overlay || !sensor) return;

    return {
      transform: `translate(${sensor.coordinates.origin.x - overlay.layout.left}px, ${sensor.coordinates.origin.y - overlay.layout.top}px) translate(-50%, -50%)`,
    };
  });

  return (
    <Layer depth={2}>
      <div
        class="w-auto max-w-75 flex flex-col gap-2 bg-surface p-2 rounded-lg z-drag shadow-md shadow-drop-shadow pointer-events-none"
        style={centeredOnPointerStyle()}
      >
        <div class="flex flex-row items-center gap-2">
          <EntityIcon size="xs" targetType={iconType()} />
          <TruncatedText size="xs">
            {activeDraggable()?.data.name}
          </TruncatedText>
        </div>
        {/* TODO: when multiselect exists */}
        {/* <Show when={activeDraggable()?.data.selectedItems.length > 1}>
        <div class={`${TEXT_SIZE_CLASSES[size ?? 'sm']} text-ink-muted pl-2`}>
          + {activeDraggable()?.data.selectedItems.length - 1} items
        </div>
      </Show> */}
      </div>
    </Layer>
  );
}

export function ItemDndProvider(props: { children: JSXElement }) {
  const [isAltPressed, setIsAltPressed] = createSignal(false);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.altKey && !isAltPressed()) {
      setIsAltPressed(true);
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (!e.altKey && isAltPressed()) {
      setIsAltPressed(false);
    }
  };

  const handlePointerMove = (e: PointerEvent) => {
    pointerPosition = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: MouseEvent) => {
    pointerPosition = { x: e.clientX, y: e.clientY };
  };

  const handlePointerEnd = () => {
    queueMicrotask(() => {
      pointerPosition = undefined;
    });
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('pointermove', handlePointerMove, { capture: true });
  window.addEventListener('pointerup', handlePointerEnd, { capture: true });
  window.addEventListener('pointercancel', handlePointerEnd, { capture: true });
  window.addEventListener('mousemove', handleMouseMove, { capture: true });
  window.addEventListener('mouseup', handlePointerEnd, { capture: true });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('pointermove', handlePointerMove, {
      capture: true,
    });
    window.removeEventListener('pointerup', handlePointerEnd, {
      capture: true,
    });
    window.removeEventListener('pointercancel', handlePointerEnd, {
      capture: true,
    });
    window.removeEventListener('mousemove', handleMouseMove, {
      capture: true,
    });
    window.removeEventListener('mouseup', handlePointerEnd, {
      capture: true,
    });
  });

  return (
    <DragOperationContext.Provider value={{ isAltKey: isAltPressed }}>
      <DragDropProvider collisionDetector={pointerWithin}>
        <DragDropSensors />
        {props.children}
        <DragOverlay class="z-drag">
          <ItemDragOverlay />
        </DragOverlay>
      </DragDropProvider>
    </DragOperationContext.Provider>
  );
}
