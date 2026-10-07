import { LIST_VIEW_ID } from '@app/constants/list-views';
import { globalSplitManager } from '@app/signal/splitLayout';
import { TOKENS } from '@core/hotkey/tokens';
import ColumnsPlusIcon from '@phosphor/columns-plus-right.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';

export function DesktopTitleBar(props: {
  navigationRef: (element: HTMLDivElement) => void;
}) {
  return (
    <div
      data-tauri-drag-region
      class="absolute inset-x-0 top-0 flex h-[40px] items-center justify-between pl-[88px] pr-3 select-none"
    >
      {/* The portal wrapper must use flex layout so inline tooltip triggers
          cannot add text-baseline space below the navigation button. */}
      <div
        ref={props.navigationRef}
        class="flex items-center [&>div]:flex [&>div]:items-center"
      />
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
