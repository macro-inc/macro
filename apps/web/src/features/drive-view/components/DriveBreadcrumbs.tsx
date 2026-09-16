import {
  ViewBreadcrumbs,
  type ViewBreadcrumbsOutletProps,
  type ViewBreadcrumbsSeparatorState,
} from '@app/components/view-shell';
import type { FileOperation } from '@components/app/split-layout/components/SplitFileMenu';
import { SplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { Permissions } from '@core/component/SharePermissions';
import type { ProjectEntity } from '@entity';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import ShareIcon from '@phosphor/share.svg';
import { For, Show } from 'solid-js';
import type { DriveLocationBreadcrumb } from '../core/breadcrumbs';
import type { DriveFolder } from '../core/types';

type DriveBreadcrumbFolder = DriveFolder & { userId: string };

function FolderBreadcrumbMenu(props: {
  folder: DriveBreadcrumbFolder;
  userId?: string;
  onOpenInNewSplit?: (folder: ProjectEntity) => void;
  onShare: (folder: ProjectEntity) => void;
  onDelete: () => void;
}) {
  const entity = (): ProjectEntity => ({
    type: 'project',
    id: props.folder.id,
    name: props.folder.name,
    ownerId: props.folder.userId,
    projectId: props.folder.parentId ?? undefined,
  });
  const operations = (): FileOperation[] => [
    ...(props.onOpenInNewSplit
      ? [
          {
            label: 'Open in new split',
            icon: ArrowSquareOutIcon,
            action: () => props.onOpenInNewSplit?.(entity()),
          },
        ]
      : []),
    {
      label: 'Share',
      icon: ShareIcon,
      action: () => props.onShare(entity()),
      group: 'sharing',
    },
    { op: 'rename' },
    { op: 'moveToProject' },
    { op: 'delete' },
  ];

  return (
    <div class="shrink-0">
      <SplitFileMenu
        id={props.folder.id}
        itemType="project"
        name={props.folder.name}
        ops={operations()}
        entity={entity()}
        entityKind="project"
        permissions={
          props.folder.userId === props.userId
            ? Permissions.OWNER
            : Permissions.CAN_VIEW
        }
        onDelete={props.onDelete}
      />
    </div>
  );
}

export function DriveLocationBreadcrumbItems(props: {
  entries: DriveLocationBreadcrumb[];
  folders: DriveBreadcrumbFolder[];
  userId?: string;
  onOpenFolderInNewSplit?: (folder: ProjectEntity) => void;
  onShareFolder: (folder: ProjectEntity) => void;
  onDeleteFolder: (folder: DriveBreadcrumbFolder) => void;
}) {
  return (
    <For each={props.entries}>
      {(entry, index) => {
        const folder = () => {
          const location = entry.location;
          if (location.kind !== 'folder' || location.id === null) return;
          return props.folders.find(({ id }) => id === location.id);
        };

        return (
          <ViewBreadcrumbs.Item
            value={entry.value}
            metadata={entry}
            order={index()}
          >
            {(item) => (
              <div class="flex min-w-0 items-center">
                <ViewBreadcrumbs.Button
                  class="max-w-48"
                  isActive={item.isActive()}
                  onClick={item.onSelect}
                  tooltip={entry.label}
                >
                  <span class="truncate">{entry.label}</span>
                </ViewBreadcrumbs.Button>
                <Show when={item.isActive() ? folder() : undefined}>
                  {(activeFolder) => (
                    <FolderBreadcrumbMenu
                      folder={activeFolder()}
                      userId={props.userId}
                      onOpenInNewSplit={props.onOpenFolderInNewSplit}
                      onShare={props.onShareFolder}
                      onDelete={() => props.onDeleteFolder(activeFolder())}
                    />
                  )}
                </Show>
              </div>
            )}
          </ViewBreadcrumbs.Item>
        );
      }}
    </For>
  );
}

function isDriveLocationBreadcrumb(
  metadata: unknown
): metadata is DriveLocationBreadcrumb {
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    'type' in metadata &&
    metadata.type === 'drive-location'
  );
}

export function DriveBreadcrumbSeparator(state: ViewBreadcrumbsSeparatorState) {
  const next = state.next?.metadata();
  if (
    isDriveLocationBreadcrumb(next) &&
    next.location.kind === 'folder' &&
    next.location.id !== null
  ) {
    return (
      <span aria-hidden="true" class="shrink-0 text-ink-extra-muted">
        /
      </span>
    );
  }

  return <ViewBreadcrumbs.Separator />;
}

export function DriveBreadcrumbsOutlet(
  props: Omit<ViewBreadcrumbsOutletProps, 'separator'>
) {
  return (
    <ViewBreadcrumbs.Outlet
      {...props}
      separator={(state) => <DriveBreadcrumbSeparator {...state} />}
    />
  );
}
