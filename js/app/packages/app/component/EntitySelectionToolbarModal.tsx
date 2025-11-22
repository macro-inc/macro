import { Hotkey } from '@core/component/Hotkey';
import { ScopedPortal } from '@core/component/ScopedPortal';
import type { EntityData } from '@macro-entity';
import CloseIcon from '@phosphor-icons/core/regular/x.svg?component-solid';

interface EntitySelectionToolbarModalProps {
  selectedEntities: EntityData[];
  onClose: VoidFunction;
  onAction: VoidFunction;
}

export const EntitySelectionToolbarModal = (
  props: EntitySelectionToolbarModalProps
) => {
  return (
    <ScopedPortal scope="split">
      <div class="absolute left-1/2 bottom-4 -translate-x-1/2">
        <div class="absolute size-full pattern-edge pattern-diagonal-4 left-1 top-1 -z-1" />
        <div class="text-sm font-bold flex flex-row items-center gap-2 p-2 bg-menu border border-edge">
          <div class="flex items-center">
            <button
              type="button"
              class="size-6 aspect-square p-1 flex items-center justify-center hover:bg-hover"
              onClick={props.onClose}
            >
              <CloseIcon class="shrink-0 size-full" />
            </button>
            <span class="text-ink font-regular w-full whitespace-nowrap">
              {props.selectedEntities.length} selected
            </span>
          </div>
          <button
            onClick={props.onAction}
            class="p-1 px-2 flex gap-1 border-edge-muted border items-center h-full w-full hover:bg-hover hover-transition-bg"
          >
            <Hotkey shortcut="cmd+k" />
            <span>Actions</span>
          </button>
          <button
            onClick={props.onClose}
            class="p-1 px-2 flex gap-1 border-edge-muted border items-center h-full w-full hover:bg-hover hover-transition-bg"
          >
            <Hotkey shortcut="ESC" />
            <span>Clear</span>
          </button>
        </div>
      </div>
    </ScopedPortal>
  );
};
