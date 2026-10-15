import { SplitPanel } from '@components/app/split-panel';
import { For, type JSX, type ParentProps, Show } from 'solid-js';
import { ListSkeleton } from './ListSkeleton';
import { SearchBar } from './SearchBar';
import { SidebarActionRow } from './SidebarActionRow';
import { SidebarCreateAction } from './SidebarCreateAction';
import { ViewShell, type ViewShellRootProps } from './ViewShell';

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

/** The view's sidebar: its title, its create action if it has one, and rows. */
function Sidebar(props: {
  title: string;
  createLabel?: string;
  children?: JSX.Element;
}) {
  return (
    <ViewShell.Aside class="flex flex-col bg-panel">
      <SidebarActionRow
        title={props.title}
        search={
          <SearchBar
            label={`Search ${props.title}`}
            placeholder={`Search ${props.title}`}
            value=""
            onValueChange={() => {}}
            disabled
          />
        }
        create={() =>
          props.createLabel ? (
            <SidebarCreateAction disabled>New</SidebarCreateAction>
          ) : undefined
        }
      />
      {props.children ?? <Rows label={`Loading ${props.title}`} class="mt-3" />}
    </ViewShell.Aside>
  );
}

/** The view's main area: its top bar title, its search box, and rows or `children`. */
function Main(props: {
  title?: string;
  searchPlaceholder?: string;
  children?: JSX.Element;
}) {
  return (
    <ViewShell.Main class="flex flex-col overflow-hidden">
      <Show when={props.title}>
        {(title) => (
          <ViewShell.TopBar workspaceActions>
            <span class="min-w-0 flex-1 truncate font-semibold text-ink text-sm">
              {title()}
            </span>
          </ViewShell.TopBar>
        )}
      </Show>
      {props.children ?? (
        <Rows label={`Loading ${props.title ?? 'view'}`} class="px-2" />
      )}
    </ViewShell.Main>
  );
}

/** Building blocks for a view's loading skeleton, rendered before its code arrives. */
export const ViewSkeleton = { Root, Sidebar, Main, Rows };
