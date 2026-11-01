import { SidePanel } from '@components/app/side-panel';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  type JSX,
  type ParentProps,
  Show,
} from 'solid-js';
import { ViewBreadcrumbs, ViewShell } from '../view-shell';
import { EntityDetailBreadcrumbSkeleton } from './EntityDetailBreadcrumbSkeleton';

/** Header actions drop their labels first, at `@max-[600px]/split-header`. */
const COMPACT_NAVIGATION_WIDTH = 600;

/** The shared Tasks detail chrome for tasks and native projects. */
export function EntityDetailTopBar(
  props: ParentProps<{
    /** Collapses while `compact`, so the title keeps its room. */
    navigation?: (compact: Accessor<boolean>) => JSX.Element;
    titleMenu?: JSX.Element;
  }>
) {
  const [topBar, setTopBar] = createSignal<HTMLDivElement>();
  const size = createElementSize(topBar);
  const compact = createMemo(
    () => (size.width ?? Infinity) < COMPACT_NAVIGATION_WIDTH
  );
  return (
    <ViewShell.TopBar
      ref={setTopBar}
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
        {(navigation) => <div class="shrink-0">{navigation()(compact)}</div>}
      </Show>
      <div class="ml-auto flex shrink-0 items-center gap-2 touch:gap-1">
        <SidePanel.HeaderActionsOutlet />
        {props.children}
        <SidePanel.Toggle />
      </div>
    </ViewShell.TopBar>
  );
}
