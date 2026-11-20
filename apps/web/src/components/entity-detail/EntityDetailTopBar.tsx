import { SidePanel } from '@components/app/side-panel';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn } from '@ui';
import {
  type Accessor,
  children,
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
    /**
     * A phone's bar keeps its room for the open entity's name: crumbs that
     * can compact (the view's return crumb, an editable icon) do.
     */
    compact?: boolean;
  }>
) {
  const titleMenu = children(() => props.titleMenu);
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
      <ViewShell.TopBarTitle>
        <ViewBreadcrumbs.Outlet
          aria-label="Task location"
          activeItem={titleMenu()}
          data-compact={props.compact ? '' : undefined}
          class={cn(
            'group/location',
            // A crumb compacted to a back arrow needs no separator after it.
            props.compact &&
              '[&>:has([data-compact-back])~svg:first-of-type]:hidden'
          )}
          fallback={<EntityDetailBreadcrumbSkeleton />}
        />
      </ViewShell.TopBarTitle>
      <Show when={props.navigation}>
        {(navigation) => (
          <HeaderIsland class="px-1">{navigation()(compact)}</HeaderIsland>
        )}
      </Show>
      <ViewShell.TopBarActions class="not-touch:gap-2">
        <SidePanel.HeaderActionsOutlet />
        {props.children}
        <SidePanel.Toggle />
      </ViewShell.TopBarActions>
    </ViewShell.TopBar>
  );
}
