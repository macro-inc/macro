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
  overlayContent?: () => JSXElement;
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

  const overlayContent = () =>
    (activeDraggable()?.data as ItemDragOverlayData | undefined)
      ?.overlayContent;

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
        <Show
          when={overlayContent()}
          fallback={
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
          }
        >
          {(content) => content()()}
        </Show>
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

  const stopTrackingPointer = () => {
    window.removeEventListener('pointermove', handlePointerMove, true);
    window.removeEventListener('pointerup', handlePointerEnd, true);
    window.removeEventListener('pointercancel', handlePointerEnd, true);
  };
  const handlePointerEnd = () => {
    stopTrackingPointer();
    queueMicrotask(() => {
      pointerPosition = undefined;
    });
  };
  const handlePointerStart = (event: PointerEvent) => {
    handlePointerMove(event);
    window.addEventListener('pointermove', handlePointerMove, {
      capture: true,
    });
    window.addEventListener('pointerup', handlePointerEnd, { capture: true });
    window.addEventListener('pointercancel', handlePointerEnd, {
      capture: true,
    });
  };
  const handleBlur = () => {
    stopTrackingPointer();
    pointerPosition = undefined;
    setIsAltPressed(false);
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('pointerdown', handlePointerStart, { capture: true });
  window.addEventListener('blur', handleBlur);

  onCleanup(() => {
    stopTrackingPointer();
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('pointerdown', handlePointerStart, true);
    window.removeEventListener('blur', handleBlur);
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
