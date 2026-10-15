import {
  useViewShell,
  ViewBreadcrumbs,
  ViewShell,
} from '@app/components/view-shell';
import { type ParentProps, Show } from 'solid-js';

/** Keep the workspace name visible when navigation no longer names the view. */
export function ReviewsListTopBar(props: ParentProps) {
  const shell = useViewShell();
  const compact = () =>
    shell.breakpoints.narrow?.() || shell.aside.isCollapsed();

  return (
    <ViewShell.TopBar
      controls={
        <div class="flex min-w-0 items-center gap-2">{props.children}</div>
      }
      workspaceActions
      class="h-12 gap-3 px-4 not-touch:pl-4"
    >
      <Show
        when={compact()}
        fallback={<ViewBreadcrumbs.Outlet aria-label="Review location" />}
      >
        <h1 class="min-w-0 truncate text-sm font-semibold text-ink">Reviews</h1>
      </Show>
    </ViewShell.TopBar>
  );
}
