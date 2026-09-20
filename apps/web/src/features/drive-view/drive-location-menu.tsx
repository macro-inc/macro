import { globalSplitManager } from '@app/signal/splitLayout';
import { SidebarOpenInSplitMenu } from '@components/app/app-sidebar/sidebar';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { batch, type ParentProps, Show } from 'solid-js';
import { useDriveView } from './context/drive-context';
import type { DriveLocation, DriveState } from './core/types';
import { DriveFolderActions } from './drive-folder-actions';

/** App-specific split/menu wiring shared by Drive's sidebar locations. */
export function DriveLocationMenu(
  props: ParentProps<{ location: DriveLocation }>
) {
  const { state, sidebar } = useDriveView();

  const panel = useSplitPanelOrThrow();

  const folder = () => {
    const location = props.location;

    return location.kind === 'folder'
      ? sidebar.folders().find((folder) => folder.id === location.id)
      : undefined;
  };

  const content = (): SplitContent => ({
    type: 'component',
    id: 'documents',
    state: {
      'drive.view.v2': {
        ...state.value(),
        location: props.location,
        scope: 'default',
        search: '',
        facets: {},
      } satisfies DriveState,
    },
  });

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
      content={content}
      triggerClass="block h-auto"
      onOpenCurrentSplit={() => state.navigate(props.location)}
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
