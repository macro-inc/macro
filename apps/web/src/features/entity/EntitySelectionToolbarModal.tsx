import { t } from '@app/lib/i18n';
import { ScopedPortal } from '@core/component/ScopedPortal';
import { TOKENS } from '@core/hotkey/tokens';
import type { EntityData } from '@entity';
import CloseIcon from '@icon/system/regular/x.svg?component-solid';
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
          <div class="menu-surface text-sm font-bold flex flex-wrap flex-row items-center gap-2 p-2">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={props.onClose}
            >
              <CloseIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
            </Button>
            <span class="text-ink font-normal flex-1 whitespace-nowrap">
              {t('entityActions.selectedCount', {
                count:
                  props.selectedCount ?? props.multiSelectEntities?.length ?? 0,
              })}
            </span>
            <Show when={props.onAction}>
              <Button
                onClick={props.onAction}
                variant="secondary"
                class="p-1 pl-2 bg-surface"
              >
                <span>{t('entityActions.actions')}</span>
                <Hotkey token={TOKENS.global.commandMenu} theme="subtle" />
              </Button>
            </Show>
            {props.children}
            <Button
              onClick={props.onClose}
              variant="secondary"
              class="p-1 pl-2 bg-surface"
            >
              <span>{t('entityActions.clear')}</span>
              <Hotkey shortcut="escape" theme="subtle" />
            </Button>
          </div>
        </div>
      </Layer>
    </ScopedPortal>
  );
};
