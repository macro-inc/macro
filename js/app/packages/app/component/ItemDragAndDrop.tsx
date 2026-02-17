import { TruncatedText } from '@core/component/FileList/TruncatedText';
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  mostIntersecting,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { EntityIcon, getEntityIconType } from 'core/component/EntityIcon';
import type { EntityDragData } from '@entity';
import {
  createContext,
  createMemo,
  createSignal,
  type JSXElement,
  onCleanup,
  useContext,
  type Accessor,
} from 'solid-js';

type DragOperationContextValue = {
  isAltKey: Accessor<boolean>;
};

const DragOperationContext = createContext<DragOperationContextValue>();

export function useDragOperation() {
  const context = useContext(DragOperationContext);
  if (!context) {
    throw new Error('useDragOperation must be used within ItemDndProvider');
  }
  return context;
}

export function ItemDragOverlay() {
  const [state] = useDragDropContext() ?? [];
  const activeDraggable = createMemo(() => {
    return state?.active.draggable;
  });

  const iconType = createMemo(() => {
    const data = activeDraggable()?.data as EntityDragData | undefined;
    if (!data) return 'default';
    return getEntityIconType(data);
  });

  return (
    <div class="w-auto max-w-[300px] flex flex-col gap-2 bg-active p-2 rounded-md z-drag shadow-sm pointer-events-none">
      <div class="flex flex-row items-center gap-2">
        <EntityIcon size="sm" targetType={iconType()} />
        <TruncatedText size="sm">{activeDraggable()?.data.name}</TruncatedText>
      </div>
      {/* TODO: when multiselect exists */}
      {/* <Show when={activeDraggable()?.data.selectedItems.length > 1}>
        <div class={`${TEXT_SIZE_CLASSES[size ?? 'sm']} text-ink-muted pl-2`}>
          + {activeDraggable()?.data.selectedItems.length - 1} items
        </div>
      </Show> */}
    </div>
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

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
  });

  return (
    <DragOperationContext.Provider value={{ isAltKey: isAltPressed }}>
      <DragDropProvider collisionDetector={mostIntersecting}>
        <DragDropSensors />
        {props.children}
        <DragOverlay class="z-drag">
          <ItemDragOverlay />
        </DragOverlay>
      </DragDropProvider>
    </DragOperationContext.Provider>
  );
}
