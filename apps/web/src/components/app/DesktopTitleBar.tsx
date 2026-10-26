import { LIST_VIEW_ID } from '@app/constants/list-views';
import { globalSplitManager } from '@app/signal/splitLayout';
import { splitBackInterceptor } from '@components/app/split-layout/back-interceptor';
import { TOKENS } from '@core/hotkey/tokens';
import CaretLeftIcon from '@icon/system/regular/caret-left.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import ColumnsPlusIcon from '@icon/system/regular/columns-plus-right.svg';
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
          variant="ghost"
          size="icon-sm"
          label="Go Back"
          hotkey={TOKENS.split.go.back}
          disabled={!activeSplit()?.canGoBack()}
          onClick={() => {
            if (splitBackInterceptor()?.()) return;
            activeSplit()?.goBack();
          }}
        >
          <CaretLeftIcon class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          label="Go Forward"
          hotkey={TOKENS.split.go.forward}
          disabled={!activeSplit()?.canGoForward()}
          onClick={() => activeSplit()?.goForward()}
        >
          <CaretRightIcon class="size-4" />
        </Button>
      </div>
      <Show when={globalSplitManager()}>
        {(manager) => (
          <Button
            variant="ghost"
            size="icon-sm"
            label="New Split"
            hotkey={TOKENS.global.createNewSplit}
            disabled={!manager().canAppendSplit()}
            onClick={() =>
              manager().openWithSplit(
                { type: 'component', id: LIST_VIEW_ID.home },
                {
                  preferNewSplit: true,
                  allowDuplicate: true,
                  replaceWhenFull: false,
                  activate: true,
                }
              )
            }
          >
            <ColumnsPlusIcon class="size-4" />
          </Button>
        )}
      </Show>
    </div>
  );
}
