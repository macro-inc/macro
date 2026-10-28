import { Show } from 'solid-js';
import { CreateMenuAction } from './components/CreateMenuAction';
import { LauncherDetails } from './components/LauncherDetails';
import { groupRecentCreateMenuItems } from './core/create-menu-details';
import { type LauncherInnerProps, LauncherShell } from './Launcher';

export default function DetailsLauncher(props: LauncherInnerProps) {
  return (
    <LauncherShell
      {...props}
      groupItems={groupRecentCreateMenuItems}
      footerAction={(state) => (
        <Show when={state.blocks()[state.selectedIndex()]}>
          {(item) => (
            <CreateMenuAction
              item={item()}
              shiftHeld={state.shiftHeld()}
              onChoose={state.choose}
            />
          )}
        </Show>
      )}
    >
      {(state) => (
        <LauncherDetails
          sections={state.sections()}
          items={state.blocks()}
          selectedIndex={state.selectedIndex()}
          itemId={state.itemId}
          onSelect={state.select}
          onChoose={state.choose}
          showHotkeys={!state.searchMode()}
          shiftHeld={state.shiftHeld()}
          scrollSelectedIntoView={state.scrollSelectedIntoView()}
        />
      )}
    </LauncherShell>
  );
}
