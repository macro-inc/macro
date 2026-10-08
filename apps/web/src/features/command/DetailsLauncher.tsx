import { LauncherDetails } from './components/LauncherDetails';
import { groupRecentCreateMenuItems } from './core/create-menu-details';
import { type LauncherInnerProps, LauncherShell } from './Launcher';

export default function DetailsLauncher(props: LauncherInnerProps) {
  return (
    <LauncherShell {...props} groupItems={groupRecentCreateMenuItems}>
      {(state) => (
        <LauncherDetails
          sections={state.sections()}
          items={state.blocks()}
          selectedIndex={state.selectedIndex()}
          itemId={state.itemId}
          onSelect={state.select}
          onChoose={state.choose}
          showHotkeys={!state.searchMode()}
          scrollSelectedIntoView={state.scrollSelectedIntoView()}
        />
      )}
    </LauncherShell>
  );
}
