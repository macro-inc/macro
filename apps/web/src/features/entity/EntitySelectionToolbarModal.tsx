import { ScopedPortal } from '@core/component/ScopedPortal';
import { TOKENS } from '@core/hotkey/tokens';
import type { EntityData } from '@entity';
import CloseIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { Button, Hotkey, Layer } from '@ui';
import { type JSX, Show } from 'solid-js';

interface EntitySelectionToolbarModalProps {
  multiSelectEntities?: EntityData[];
  /** Native list rows may provide their count without adopting EntityData. */
  selectedCount?: number;
  onClose: VoidFunction;
  onAction?: VoidFunction;
  children?: JSX.Element;
}

export const EntitySelectionToolbarModal = (
  props: EntitySelectionToolbarModalProps
) => {
  return (
    <ScopedPortal scope="split">
      <Layer depth={2}>
        <div class="absolute left-1/2 bottom-16 w-max max-w-[calc(100%-1rem)] -translate-x-1/2">
          <div class="text-sm font-bold flex flex-wrap rounded-xl flex-row items-center gap-2 p-2 bg-surface border border-edge shadow-xl shadow-drop-shadow">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={props.onClose}
            >
              <CloseIcon />
            </Button>
            <span class="text-ink font-normal flex-1 whitespace-nowrap">
              {props.selectedCount ?? props.multiSelectEntities?.length ?? 0}{' '}
              selected
            </span>
            <Show when={props.onAction}>
              <Button
                onClick={props.onAction}
                variant="outline"
                class="p-1 pl-2 rounded-md bg-surface"
                depth={3}
              >
                <span>Actions</span>
                <Hotkey token={TOKENS.global.commandMenu} theme="subtle" />
              </Button>
            </Show>
            {props.children}
            <Button
              onClick={props.onClose}
              variant="outline"
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
