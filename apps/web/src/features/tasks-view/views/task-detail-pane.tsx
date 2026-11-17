import { EntityDetailBreadcrumbSkeleton } from '@app/components/entity-detail/EntityDetailBreadcrumbSkeleton';
import { ViewBreadcrumbs, ViewShell } from '@app/components/view-shell';
import { SplitHeaderScope } from '@components/app/SplitHeaderScope';
import { SidePanel } from '@components/app/side-panel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useDocumentShareModal } from '@core/component/TopBar/shareModal';
import type { ParentProps } from 'solid-js';

/** A task in desktop Tasks: its location, Share and Info above the task. */
export function TaskDetailPane(props: ParentProps<{ documentId: string }>) {
  const panel = useSplitPanelOrThrow();
  const openShare = useDocumentShareModal(() => ({
    documentId: props.documentId,
    blockAlias: 'task',
  }));

  return (
    // The task keeps this bar, so it never draws into an enclosing host's.
    <SplitHeaderScope.Root when={false}>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <ViewShell.TopBar>
          <ViewShell.TopBarTitle>
            <ViewBreadcrumbs.Outlet
              aria-label="Task location"
              fallback={<EntityDetailBreadcrumbSkeleton />}
            />
          </ViewShell.TopBarTitle>
          <ViewShell.TopBarActions>
            <SidePanel.HeaderActionsOutlet />
            <ShareTrigger
              onClick={openShare}
              id={props.documentId}
              blockType="task"
              hotkeyScope={panel.splitHotkeyScope}
            />
            <SidePanel.Toggle />
          </ViewShell.TopBarActions>
        </ViewShell.TopBar>
        <div class="relative min-h-0 min-w-0 flex-1">{props.children}</div>
      </div>
    </SplitHeaderScope.Root>
  );
}
