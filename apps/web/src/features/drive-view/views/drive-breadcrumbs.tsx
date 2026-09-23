import { ViewBreadcrumbs } from '@app/components/view-shell';
import type { ParentProps } from 'solid-js';
import { DriveLocationBreadcrumbItems } from '../components/DriveBreadcrumbs';
import { useDriveView } from '../context/drive-context';
import type { DriveLocationBreadcrumb } from '../core/breadcrumbs';
import { useDriveDetailNavigation } from '../drive-detail-navigation';

export function DriveBreadcrumbs(
  props: ParentProps<{ entries: DriveLocationBreadcrumb[] }>
) {
  const { state, sidebar, actions } = useDriveView();

  const navigation = useDriveDetailNavigation();

  return (
    <ViewBreadcrumbs.Root
      value={navigation.active()?.value ?? props.entries.at(-1)!.value}
      onChange={(value) => {
        const breadcrumb = props.entries.find((entry) => entry.value === value);

        if (!breadcrumb) {
          navigation.popTo(value);

          return;
        }

        const current = state.value().location;

        const location = breadcrumb.location;

        const isCurrent =
          (current.kind === 'tab' &&
            location.kind === 'tab' &&
            current.tab === location.tab) ||
          (current.kind === 'folder' &&
            location.kind === 'folder' &&
            current.id === location.id);

        if (isCurrent) navigation.clear();
        else state.navigate(location);
      }}
    >
      <DriveLocationBreadcrumbItems
        entries={props.entries}
        folders={sidebar.folders()}
        userId={actions.userId()}
        onOpenFolderInNewSplit={
          actions.canOpenNewSplit() ? actions.openFolderInNewSplit : undefined
        }
        onShareFolder={actions.shareFolder}
        onDeleteFolder={(folder) => {
          const parentId = sidebar
            .folders()
            .some(({ id }) => id === folder.parentId)
            ? folder.parentId
            : null;

          state.selectFolder(parentId ?? null);
        }}
      />
      {props.children}
    </ViewBreadcrumbs.Root>
  );
}
