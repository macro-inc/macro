import { t } from '@app/lib/i18n';
import {
  EntityIcon,
  type EntityIconSelector,
  getEntityIconType,
} from '@core/component/EntityIcon';
import { TruncatedText } from '@core/component/FileList/TruncatedText';
import type { EntityDragData } from '@entity';
import {
  DragDropProvider,
  DragDropSensors,
  DragOverlay,
  useDragDropContext,
} from '@thisbeyond/solid-dnd';
import { Layer } from '@ui';
import {
  type Accessor,
  createContext,
  createMemo,
  createSignal,
  type JSXElement,
  onCleanup,
  Show,
  useContext,
} from 'solid-js';
import { createPointerCollisionDetector } from './pointer-collision';

type DragOperationContextValue = {
  isAltKey: Accessor<boolean>;
};

export type ItemDragOverlayData = {
  overlayIcon?: () => JSXElement;
};

const DragOperationContext = createContext<DragOperationContextValue>();

/** Optional for composed entity rows rendered outside the draggable workspace. */
export function useOptionalDragOperation() {
  return useContext(DragOperationContext);
}

export function useDragOperation() {
  const context = useOptionalDragOperation();
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
  const overlayIcon = () =>
    (activeDraggable()?.data as ItemDragOverlayData | undefined)?.overlayIcon;

  const iconType = createMemo((): EntityIconSelector => {
    const data = activeDraggable()?.data;
    if (!data) return 'default';
    // Channel label drags carry a precomputed icon type (see
    // ChannelLabelDragData) instead of an entity shape.
    if (data.dragType === 'channel-label') {
      return data.iconType as EntityIconSelector;
    }
    if (overlayIcon()) return 'default';
    return getEntityIconType(data as EntityDragData);
  });

  const additionalCount = () => {
    const data = activeDraggable()?.data as EntityDragData | undefined;
    return (data?.selection?.entities().length ?? 1) - 1;
  };

  // Beside the pointer, not under it: a narrow target like a sidebar folder
  // has to stay visible while it is being aimed at.
  const besidePointerStyle = createMemo(() => {
    const overlay = state?.active.overlay;
    const sensor = state?.active.sensor;
    if (!overlay || !sensor) return;

    return {
      transform: `translate(${sensor.coordinates.origin.x - overlay.layout.left + 12}px, ${sensor.coordinates.origin.y - overlay.layout.top + 12}px)`,
    };
  });

  return (
    <Layer depth={2}>
      <div
        class="w-auto max-w-75 flex flex-col gap-2 bg-surface p-2 rounded-lg z-drag shadow-md shadow-drop-shadow pointer-events-none"
        style={besidePointerStyle()}
      >
        <div class="flex flex-row items-center gap-2">
          <Show
            when={overlayIcon()}
            fallback={<EntityIcon size="xs" targetType={iconType()} />}
          >
            {(icon) => icon()()}
          </Show>
          <TruncatedText size="xs">
            {activeDraggable()?.data.name}
          </TruncatedText>
        </div>
        <Show when={additionalCount() > 0}>
          <div class="pl-6 text-xs text-ink-muted">
            {t('entityActions.dragMoreItems', { count: additionalCount() })}
          </div>
        </Show>
      </div>
    </Layer>
  );
}

export function ItemDndProvider(props: { children: JSXElement }) {
  let pointerPosition: { x: number; y: number } | undefined;
  const pointerWithin = createPointerCollisionDetector(() => pointerPosition);
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
        <DragOverlay class="z-drag pointer-events-none">
          <ItemDragOverlay />
        </DragOverlay>
      </DragDropProvider>
    </DragOperationContext.Provider>
  );
}
