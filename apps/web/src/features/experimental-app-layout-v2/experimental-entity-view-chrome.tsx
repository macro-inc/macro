import { LIST_VIEW_ID } from '@app/constants/list-views';
import { SplitHeaderStart } from '@components/app/split-layout/components/SplitHeader';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import MenuIcon from '@phosphor/list.svg';
import type { Favorite } from '@service-storage/generated/schemas/favorite';
import type { Project } from '@service-storage/generated/schemas/project';
import { Button, cn, Dropdown } from '@ui';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { setExperimentalViewNavIntent } from './experimental-view-nav-intent';
import {
  ExperimentalEmailNavigation,
  ExperimentalLibraryNavigation,
  ExperimentalTaskNavigation,
  type LibrarySection,
} from './experimental-view-navigation';
import { ExperimentalViewSidebar } from './experimental-view-sidebar';

export type ExperimentalEntityViewHost = 'mail' | 'tasks' | 'documents';

const DRIVE_ENTITY_TYPES = new Set([
  'md',
  'pdf',
  'code',
  'image',
  'canvas',
  'video',
  'write',
  'unknown',
  'snippet',
]);

const [mailViewSidebarCollapsed, setMailViewSidebarCollapsed] =
  createSignal(false);
const [tasksViewSidebarCollapsed, setTasksViewSidebarCollapsed] =
  createSignal(false);

const HOST_LABEL: Record<ExperimentalEntityViewHost, string> = {
  mail: 'Email',
  tasks: 'Tasks',
  documents: 'Drive',
};

/** Resolve which list nav belongs on an entity split, if any. */
export function experimentalEntityViewHost(
  content: SplitContent
): ExperimentalEntityViewHost | undefined {
  if (content.type === 'component') return undefined;
  if (content.type === 'email') return 'mail';
  if (content.type === 'task') return 'tasks';
  if (DRIVE_ENTITY_TYPES.has(content.type)) return 'documents';
  return undefined;
}

function openHostList(
  layout: ReturnType<typeof useSplitLayout>,
  host: ExperimentalEntityViewHost
) {
  layout.replaceSplit({
    content: { type: 'component', id: LIST_VIEW_ID[host] },
    referredFrom: 'sidebar',
  });
}

/** Inner list nav for an entity split. Clicks return to the matching list. */
function EntityViewNavigation(props: {
  host: ExperimentalEntityViewHost;
  onOpen?: () => void;
}) {
  const layout = useSplitLayout();

  const openMailTab = (tab: string) => {
    setExperimentalViewNavIntent({ host: 'mail', tab });
    openHostList(layout, 'mail');
    props.onOpen?.();
  };

  const openTasksTab = (tab: string) => {
    setExperimentalViewNavIntent({ host: 'tasks', tab });
    openHostList(layout, 'tasks');
    props.onOpen?.();
  };

  const openDocumentsSection = (section: LibrarySection) => {
    setExperimentalViewNavIntent({ host: 'documents', section });
    openHostList(layout, 'documents');
    props.onOpen?.();
  };

  const openDocumentsProject = (project: Project) => {
    setExperimentalViewNavIntent({
      host: 'documents',
      projectId: project.id,
    });
    openHostList(layout, 'documents');
    props.onOpen?.();
  };

  const openDocumentsFavorites = (favorites: Favorite[]) => {
    setExperimentalViewNavIntent({ host: 'documents', favorites });
    openHostList(layout, 'documents');
    props.onOpen?.();
  };

  return (
    <Show
      when={props.host === 'mail'}
      fallback={
        <Show
          when={props.host === 'tasks'}
          fallback={
            <ExperimentalLibraryNavigation
              onSelectSection={openDocumentsSection}
              onSelectProject={openDocumentsProject}
              onSelectFavorites={openDocumentsFavorites}
              onOpen={props.onOpen}
            />
          }
        >
          <ExperimentalTaskNavigation onSelectTab={openTasksTab} />
        </Show>
      }
    >
      <ExperimentalEmailNavigation onSelectTab={openMailTab} />
    </Show>
  );
}

function ViewSidebarHamburger(props: {
  host: ExperimentalEntityViewHost;
  collapsed: boolean;
  onToggle: () => void;
  class?: string;
}) {
  const label = () =>
    props.collapsed
      ? `Expand ${HOST_LABEL[props.host]} navigation`
      : `Collapse ${HOST_LABEL[props.host]} navigation`;

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      class={cn(
        'size-8! shrink-0 rounded-full',
        !props.collapsed && 'bg-active text-ink',
        props.class
      )}
      label={label()}
      aria-label={label()}
      aria-expanded={!props.collapsed}
      onClick={props.onToggle}
    >
      <MenuIcon class="size-4" />
    </Button>
  );
}

/**
 * Keeps Email, Tasks, or Drive nav beside an opened entity. Drive starts
 * collapsed (Google Drive); Email and Tasks stay open unless the user hides
 * them. A hamburger in the split header restores the panel.
 */
export function ExperimentalEntityViewChrome(
  props: ParentProps<{ host: ExperimentalEntityViewHost }>
) {
  const documentsCollapsed = createSignal(true);
  const collapsed = () =>
    props.host === 'documents'
      ? documentsCollapsed[0]()
      : props.host === 'mail'
        ? mailViewSidebarCollapsed()
        : tasksViewSidebarCollapsed();
  const setCollapsed = (next: boolean | ((current: boolean) => boolean)) => {
    const resolve = (current: boolean) =>
      typeof next === 'function' ? next(current) : next;
    if (props.host === 'documents') {
      documentsCollapsed[1](resolve);
      return;
    }
    if (props.host === 'mail') {
      setMailViewSidebarCollapsed(resolve);
      return;
    }
    setTasksViewSidebarCollapsed(resolve);
  };
  const toggleCollapsed = () => setCollapsed((current) => !current);
  const [viewMenuOpen, setViewMenuOpen] = createSignal(false);

  const hamburger = (className?: string) => (
    <>
      <ViewSidebarHamburger
        host={props.host}
        collapsed={collapsed()}
        onToggle={toggleCollapsed}
        class={cn('@max-[720px]/split-header:hidden', className)}
      />
      <div class={cn('hidden @max-[720px]/split-header:block', className)}>
        <Dropdown
          open={viewMenuOpen()}
          onOpenChange={setViewMenuOpen}
          placement="bottom-start"
        >
          <Dropdown.Trigger
            variant="ghost"
            size="icon-sm"
            class="size-8! shrink-0 rounded-full"
            label={`Open ${HOST_LABEL[props.host]} navigation`}
            aria-label={`Open ${HOST_LABEL[props.host]} navigation`}
          >
            <MenuIcon class="size-4" />
          </Dropdown.Trigger>
          <Dropdown.Content class="w-72 rounded-2xl p-2">
            <div class="rounded-xl bg-menu">
              <EntityViewNavigation
                host={props.host}
                onOpen={() => setViewMenuOpen(false)}
              />
            </div>
          </Dropdown.Content>
        </Dropdown>
      </div>
    </>
  );

  return (
    <div class="@container/experimental-soup flex size-full min-h-0">
      <SplitHeaderStart>{hamburger()}</SplitHeaderStart>
      <ExperimentalViewSidebar
        label={`${HOST_LABEL[props.host]} navigation`}
        class="mb-0 border-r-0! pt-2"
        collapsed={collapsed()}
      >
        <div class="mt-5 min-h-0 flex-1 overflow-y-auto">
          <EntityViewNavigation host={props.host} />
        </div>
      </ExperimentalViewSidebar>
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">{props.children}</div>
    </div>
  );
}
