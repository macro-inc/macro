import { SplitPanel } from '@components/app/split-panel';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { cn } from '@ui';
import { For, type JSX, type ParentProps, Show } from 'solid-js';
import { ListHeader } from './ListHeader';
import { ListSkeleton } from './ListSkeleton';
import { SidebarCreateHeader } from './SidebarCreateButton';
import { ViewShell, type ViewShellRootProps } from './ViewShell';
import { ViewSidebar } from './ViewSidebar';

const ROW_WIDTHS = [
  'w-3/5',
  'w-4/5',
  'w-1/2',
  'w-2/3',
  'w-3/4',
  'w-1/2',
  'w-4/5',
  'w-3/5',
];

/** Shimmering rows, the shape of a list that hasn't loaded. */
function Rows(props: { label: string; count?: number; class?: string }) {
  return (
    <ListSkeleton.Root label={props.label} class={props.class}>
      <For each={ROW_WIDTHS.slice(0, props.count ?? ROW_WIDTHS.length)}>
        {(width) => (
          <ListSkeleton.Row>
            <ListSkeleton.Bar class="size-4 shrink-0 rounded" />
            <ListSkeleton.Bar class={width} />
          </ListSkeleton.Row>
        )}
      </For>
    </ListSkeleton.Root>
  );
}

/**
 * A view's frame while its code loads: the same pane and view shell the view
 * renders, keyed by its aside preference so widths and collapse match.
 */
function Root(
  props: ParentProps<{
    asidePreferenceKey: string;
    aside?: ViewShellRootProps['aside'];
    main?: ViewShellRootProps['main'];
  }>
) {
  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <div class="size-full min-h-0 bg-panel">
          <ViewShell.Root
            asidePreferenceKey={props.asidePreferenceKey}
            aside={props.aside ?? { preserveDuringResize: false }}
            main={props.main ?? { preferredWidth: 640 }}
            resizable
          >
            {props.children}
          </ViewShell.Root>
        </div>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}

// The sidebar's search field, before the view can search.
const sidebarSearch = () => <ListSkeleton.Bar class="h-8 w-full" />;

/** The view's sidebar: its title and search, its create action if it has one, and rows. */
function Sidebar(props: {
  title: string;
  createLabel?: string;
  children?: JSX.Element;
}) {
  return (
    <ViewShell.Aside class="flex flex-col bg-panel">
      <Show
        when={props.createLabel}
        fallback={
          <Show when={!isTouchDevice()}>
            <ViewSidebar.Header search={sidebarSearch}>
              <div class="flex min-w-0 items-center gap-1">
                <ViewSidebar.CloseButton class="shrink-0" />
                <ViewSidebar.Title>{props.title}</ViewSidebar.Title>
              </div>
            </ViewSidebar.Header>
          </Show>
        }
      >
        {(label) => (
          <SidebarCreateHeader
            title={props.title}
            label={label()}
            onCreate={() => {}}
            search={sidebarSearch}
          />
        )}
      </Show>
      {props.children ?? <Rows label={`Loading ${props.title}`} class="mt-3" />}
    </ViewShell.Aside>
  );
}

// Icon-only islands are 32px per control.
const ISLAND_WIDTH: Record<number, string> = {
  1: 'w-8',
  2: 'w-16',
  3: 'w-24',
  4: 'w-32',
};

/**
 * A control that hasn't loaded: a shimmering 32px pill. A string sizes it to
 * that label; a number is an icon-only island of that many controls.
 */
function ControlPill(props: { control: string | number; class?: string }) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'skeleton-shimmer inline-flex h-8 shrink-0 items-center rounded-full bg-skeleton text-sm text-transparent select-none',
        typeof props.control === 'number'
          ? (ISLAND_WIDTH[props.control] ?? 'w-8')
          : 'px-3',
        props.class
      )}
    >
      {typeof props.control === 'string' ? props.control : null}
    </span>
  );
}

/**
 * The view's main area: on desktop its one-row header (title, view tabs, and
 * header controls as placeholders); on touch its search box. Then rows or
 * `children`.
 */
function Main(props: {
  title?: string;
  /** View tab labels, left of the header controls. */
  tabs?: readonly string[];
  /** Header controls in order: a label, or an icon-only island's control count. */
  controls?: readonly (string | number)[];
  /** Touch only: the search box above the list. */
  searchPlaceholder?: string;
  children?: JSX.Element;
}) {
  return (
    <ViewShell.Main class="flex flex-col overflow-hidden">
      <Show when={props.title}>
        {(title) => (
          <ListHeader
            title={
              <div class="flex min-w-0 items-center gap-3">
                <span class="truncate font-semibold text-ink text-sm">
                  {title()}
                </span>
                <div class="flex shrink-0 items-center gap-1.5">
                  <For each={props.tabs}>
                    {(tab) => <ControlPill control={tab} />}
                  </For>
                </div>
              </div>
            }
          >
            <For each={props.controls}>
              {(control) => <ControlPill control={control} />}
            </For>
          </ListHeader>
        )}
      </Show>
      <Show when={isTouchDevice() && props.searchPlaceholder}>
        {(placeholder) => (
          <ViewShell.Header>
            <div class="flex h-10 w-full max-w-md min-w-0 items-center gap-2 rounded-full border border-edge-button bg-control not-touch:elevated px-3 text-ink-placeholder text-sm">
              <MagnifyingGlassIcon class="size-4 shrink-0 text-ink-extra-muted" />
              <span class="truncate">{placeholder()}</span>
            </div>
          </ViewShell.Header>
        )}
      </Show>
      {props.children ?? (
        <Rows label={`Loading ${props.title ?? 'view'}`} class="px-2" />
      )}
    </ViewShell.Main>
  );
}

/** Building blocks for a view's loading skeleton, rendered before its code arrives. */
export const ViewSkeleton = {
  Root,
  Sidebar,
  Main,
  Rows,
  Control: ControlPill,
};
