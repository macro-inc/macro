import { LIST_VIEW_ID } from '@app/constants/list-views';
import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { splitBackInterceptor } from '@components/app/split-layout/back-interceptor';
import { DesktopTabStrip } from '@components/app/tab-layout/DesktopTabStrip';
import { TOKENS } from '@core/hotkey/tokens';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import ColumnsPlusIcon from '@icon/system/regular/columns-plus-right.svg';
import RowsPlusIcon from '@icon/system/regular/rows-plus-bottom.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';

export function DesktopTitleBar() {
  const activeSplit = () => globalSplitManager()?.activeSplit();

  return (
    <div
      data-tauri-drag-region
      class="absolute inset-x-0 top-0 flex h-[40px] items-center justify-between pl-[88px] pr-3 select-none"
    >
      <div class="flex items-center gap-1">
        <Button
          aria-label={t('splitMenu.goBack')}
          tooltip={{
            content: t('splitMenu.goBack'),
            hotkey: TOKENS.split.go.back,
          }}
          variant="ghost"
          size="icon-sm"
          disabled={!activeSplit()?.canGoBack()}
          onClick={() => {
            if (splitBackInterceptor()?.()) return;
            activeSplit()?.goBack();
          }}
        >
          <CaretLeftIcon class="size-4" />
        </Button>
        <Button
          aria-label={t('splitMenu.goForward')}
          tooltip={{
            content: t('splitMenu.goForward'),
            hotkey: TOKENS.split.go.forward,
          }}
          variant="ghost"
          size="icon-sm"
          disabled={!activeSplit()?.canGoForward()}
          onClick={() => activeSplit()?.goForward()}
        >
          <CaretRightIcon class="size-4" />
        </Button>
      </div>
      <div
        data-tauri-drag-region
        class="flex h-full min-w-0 flex-1 items-center"
      >
        <DesktopTabStrip />
      </div>
      <Show when={globalSplitManager()}>
        {(manager) => {
          const activeId = () => manager().activeSplitId();
          /** Room to split the active split toward `side`; with none active, room at the end. */
          const canSplit = (side: 'right' | 'below') => {
            const active = activeId();
            if (!active) return manager().canAppendSplit();

            return manager().canSplit(active, side);
          };
          /** Opens Home splitting the active split toward `side`. */
          const openHome = (side: 'right' | 'below') => {
            const active = activeId();
            manager().openWithSplit(
              { type: 'component', id: LIST_VIEW_ID.home },
              {
                preferNewSplit: true,
                allowDuplicate: true,
                replaceWhenFull: false,
                activate: true,
                beside: active && { split: active, side },
              }
            );
          };

          return (
            <div class="flex items-center gap-1">
              <Button
                aria-label={t('splitMenu.newSplitBelow')}
                tooltip={{
                  content: t('splitMenu.newSplitBelow'),
                  hotkey: TOKENS.global.createNewSplitBelow,
                }}
                variant="ghost"
                size="icon-sm"
                disabled={!canSplit('below')}
                onClick={() => openHome('below')}
              >
                <RowsPlusIcon class="size-4" />
              </Button>
              <Button
                aria-label={t('splitMenu.newSplit')}
                tooltip={{
                  content: t('splitMenu.newSplit'),
                  hotkey: TOKENS.global.createNewSplit,
                }}
                variant="ghost"
                size="icon-sm"
                disabled={!canSplit('right')}
                onClick={() => openHome('right')}
              >
                <ColumnsPlusIcon class="size-4" />
              </Button>
            </div>
          );
        }}
      </Show>
    </div>
  );
}
