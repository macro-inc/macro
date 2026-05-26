import { ScopedPortal } from '@core/component/ScopedPortal';
import { TOKENS } from '@core/hotkey/tokens';
import type { EntityData } from '@entity';
import CloseIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { Button, Hotkey, Layer } from '@ui';

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
      <Layer depth={2}>
        <div class="absolute left-1/2 bottom-16 -translate-x-1/2">
          <div class="text-sm font-bold flex rounded-xl flex-row items-center gap-2 p-2 bg-surface border border-edge shadow-xl shadow-drop-shadow">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={props.onClose}
            >
              <CloseIcon />
            </Button>
            <span class="text-ink font-regular w-full whitespace-nowrap">
              {props.multiSelectEntities.length} selected
            </span>
            <Button
              onClick={props.onAction}
              variant="base"
              class="p-1 pl-2 rounded-md bg-surface"
              depth={3}
            >
              <span>Actions</span>
              <Hotkey token={TOKENS.global.commandMenu} theme="subtle" />
            </Button>
            <Button
              onClick={props.onClose}
              variant="base"
              class="p-1 pl-2 rounded-md bg-surface"
              depth={3}
            >
              <span>Clear</span>
              <Hotkey shortcut="escape" theme="subtle" />
            </Button>
          </div>
        </div>
      </Layer>
    </ScopedPortal>
  );
};
