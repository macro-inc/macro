import { globalSplitManager } from '@app/signal/splitLayout';
import { useNavigate } from '@app/split-router';
import { SidebarOpenInSplitMenu } from '@components/app/app-sidebar/sidebar';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { batch, type ParentProps, Show } from 'solid-js';
import { useDriveView } from './context/drive-context';
import type { DriveLocation } from './core/types';
import { DriveFolderActions } from './drive-folder-actions';
import { driveDestination } from './drive-route-navigation';

/** App-specific split/menu wiring shared by Drive's sidebar locations. */
export function DriveLocationMenu(
  props: ParentProps<{ location: DriveLocation }>
) {
  const { state, sidebar } = useDriveView();

  const panel = useSplitPanelOrThrow();

  const navigate = useNavigate();

  const folder = () => {
    const location = props.location;

    return location.kind === 'folder'
      ? sidebar.folders().find((folder) => folder.id === location.id)
      : undefined;
  };

  const openFullscreen = () => {
    const manager = globalSplitManager();

    if (!manager) return;

    batch(() => {
      state.navigate(props.location);

      for (const split of manager.splits()) {
        if (split.id !== panel.handle.id) manager.removeSplit(split.id);
      }

      manager.unSpotlightSplit();
      panel.handle.activate();
    });
  };

  return (
    <SidebarOpenInSplitMenu
      triggerClass="block h-auto"
      onOpenCurrentSplit={() => state.navigate(props.location)}
      onOpenNewSplit={() =>
        navigate(driveDestination(props.location), { target: 'new-split' })
      }
      onOpenFullscreen={openFullscreen}
      additionalActions={
        <Show when={folder()}>
          {(folder) => <DriveFolderActions folder={folder()} />}
        </Show>
      }
    >
      {props.children}
    </SidebarOpenInSplitMenu>
  );
}
