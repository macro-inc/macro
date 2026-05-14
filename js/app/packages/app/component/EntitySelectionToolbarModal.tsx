import { ScopedPortal } from '@core/component/ScopedPortal';
import { TOKENS } from '@core/hotkey/tokens';
import type { EntityData } from '@entity';
import CloseIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { Hotkey } from '@ui';

interface EntitySelectionToolbarModalProps {
  multiSelectEntities: EntityData[];
  onClose: VoidFunction;
  onAction: VoidFunction;
}

export const EntitySelectionToolbarModal = (
  props: EntitySelectionToolbarModalProps
) => {
  return (
    <ScopedPortal scope="split">
      <div class="absolute left-1/2 bottom-16 -translate-x-1/2">
        {/*<div class="absolute size-full pattern-edge-muted pattern-diagonal-4 left-1 top-1 -z-1" />*/}
        <div class="text-sm font-bold flex rounded-sm flex-row items-center gap-2 p-2 bg-surface border border-edge-muted">
          <div class="flex items-center">
            <button
              type="button"
              class="size-6 aspect-square p-1 flex items-center justify-center hover:bg-hover"
              onClick={props.onClose}
            >
              <CloseIcon class="shrink-0 size-full" />
            </button>
            <span class="text-ink font-regular w-full whitespace-nowrap">
              {props.multiSelectEntities.length} selected
            </span>
          </div>
          <button
            onClick={props.onAction}
            class="p-1 px-2 flex gap-1 border-edge-muted rounded-xs border items-center size-full hover:bg-hover hover-transition-bg"
          >
            <div class="flex border border-edge-muted text-xxs rounded-xs items-center px-1.5 py-px font-normal">
              <Hotkey token={TOKENS.global.commandMenu} class="space-x-1" />
            </div>
            <span>Actions</span>
          </button>
          <button
            onClick={props.onClose}
            class="p-1 px-2 flex gap-1 border-edge-muted rounded-xs border items-center size-full hover:bg-hover hover-transition-bg"
          >
            <div class="flex border border-edge-muted text-xxs rounded-xs items-center px-1.5 py-px font-normal">
              <Hotkey shortcut="escape" />
            </div>
            <span>Clear</span>
          </button>
        </div>
      </div>
    </ScopedPortal>
  );
};
