import {
  ViewBreadcrumbs,
  type ViewBreadcrumbsOutletProps,
  type ViewBreadcrumbsSeparatorState,
} from '@app/components/view-shell';
import { For } from 'solid-js';
import type { DriveLocationBreadcrumb } from '../core/breadcrumbs';

export function DriveLocationBreadcrumbItems(props: {
  entries: DriveLocationBreadcrumb[];
}) {
  return (
    <For each={props.entries}>
      {(entry, index) => (
        <ViewBreadcrumbs.Item
          value={entry.value}
          metadata={entry}
          order={index()}
        >
          {(item) => (
            <ViewBreadcrumbs.Button
              class="max-w-48"
              isActive={item.isActive()}
              onClick={item.onSelect}
              tooltip={entry.label}
            >
              <span class="truncate">{entry.label}</span>
            </ViewBreadcrumbs.Button>
          )}
        </ViewBreadcrumbs.Item>
      )}
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
