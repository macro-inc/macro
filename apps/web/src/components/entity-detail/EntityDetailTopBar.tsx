import { SidePanel } from '@components/app/side-panel';
import { cn } from '@ui';
import { type JSX, type ParentProps, Show } from 'solid-js';
import { ViewBreadcrumbs, ViewShell } from '../view-shell';
import { EntityDetailBreadcrumbSkeleton } from './EntityDetailBreadcrumbSkeleton';

/** The shared Tasks detail chrome for tasks and native projects. */
export function EntityDetailTopBar(
  props: ParentProps<{ navigation?: JSX.Element; titleMenu?: JSX.Element }>
) {
  return (
    <ViewShell.TopBar
      class={cn(
        'touch:flex touch:h-auto touch:min-h-12 touch:pt-[calc(var(--mobile-content-inset-top,var(--safe-top,0px))+0.75rem)]',
        props.navigation && 'gap-3'
      )}
    >
      <ViewBreadcrumbs.Outlet
        aria-label="Task location"
        fallback={<EntityDetailBreadcrumbSkeleton />}
      >
        {props.titleMenu}
      </ViewBreadcrumbs.Outlet>
      <Show when={props.navigation}>
        <div class="min-w-0 overflow-x-auto">{props.navigation}</div>
      </Show>
      <div class="ml-auto flex shrink-0 items-center gap-2 touch:gap-1">
        <SidePanel.HeaderActionsOutlet />
        {props.children}
        <SidePanel.Toggle />
      </div>
    </ViewShell.TopBar>
  );
}
