import { CommandMenuList } from '@ui';
import { Show } from 'solid-js';
import {
  type LauncherInnerProps,
  LauncherMenuItem,
  LauncherShell,
} from './Launcher';

export default function ListLauncher(props: LauncherInnerProps) {
  return (
    <LauncherShell {...props}>
      {(state) => (
        <Show
          when={state.blocks().length}
          fallback={
            <div
              role="status"
              class="flex h-[min(21rem,calc(75vh-6.25rem))] items-center justify-center text-sm text-ink-muted"
            >
              No matching create options
            </div>
          }
        >
          <CommandMenuList
            items={state.blocks()}
            selectedIndex={state.selectedIndex()}
            scrollSelectedIntoView={state.scrollSelectedIntoView()}
            itemId={state.itemId}
            onSelect={state.choose}
            onItemMouseMove={state.select}
            class="h-[min(21rem,calc(75vh-6.25rem))] max-h-none p-2"
          >
            {(item, index) => (
              <LauncherMenuItem
                creatableBlock={item}
                selected={state.selectedIndex() === index()}
                showHotkey={!state.searchMode()}
              />
            )}
          </CommandMenuList>
        </Show>
      )}
    </LauncherShell>
  );
}
