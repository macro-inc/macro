import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import { isResponseFreeNetworkError } from '@core/util/request-error';
import PlusIcon from '@phosphor/plus.svg';
import StackIcon from '@phosphor/stack.svg';
import { createSignal, For, Show, Suspense } from 'solid-js';
import { ProjectsSidebarSkeleton } from '../components/project-skeletons';
import { useProjectsContext } from '../context/projects-context';

export type ProjectsSidebarProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  activeProjectId?: string;
  onOpen(id: string, event: MouseEvent): void;
  onCreate(): void;
};

export function ProjectsSidebar(props: ProjectsSidebarProps) {
  // Shares the collection's authorized Soup query and normalized cache client.
  const source = useProjectsContext().createCollectionSource(
    () => ({ sort: 'updated' }),
    () => props.open
  );
  const [pending, setPending] = createSignal(false);
  const [readFailure, setReadFailure] = createSignal<{
    action: 'more' | 'refresh';
    cause: unknown;
  }>();
  const failed = () => {
    if (source.error()) return true;
    const failure = readFailure();
    if (!failure) return false;
    // Refresh actions still reject on transport failure; do not resurrect the
    // warning that the source suppressed for its usable cached rows.
    return !(
      failure.action === 'refresh' &&
      isResponseFreeNetworkError(failure.cause) &&
      source.rows() !== undefined
    );
  };
  const readProjects = async (action: 'more' | 'refresh') => {
    if (pending() || source.loadingMore()) return;
    setPending(true);
    setReadFailure(undefined);
    try {
      if (action === 'more') await source.loadMore();
      else await source.refresh();
    } catch (cause) {
      setReadFailure({ action, cause });
    } finally {
      setPending(false);
    }
  };

  return (
    <CollapsibleSection.Root
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <CollapsibleSection.Header>
        <CollapsibleSection.Trigger class="flex-1">
          <span class="min-w-0 truncate">My projects</span>
          <CollapsibleSection.Indicator />
        </CollapsibleSection.Trigger>
        <CollapsibleSection.Action label="New project" onClick={props.onCreate}>
          <PlusIcon class="size-3.5" />
        </CollapsibleSection.Action>
      </CollapsibleSection.Header>
      <CollapsibleSection.Content>
        <Suspense fallback={<ProjectsSidebarSkeleton />}>
          <ViewSidebar.Nav
            aria-label="My projects"
            class="max-h-52 overflow-y-auto overscroll-contain"
          >
            <For each={source.rows()}>
              {({ project }) => (
                <ViewSidebar.Item
                  active={props.activeProjectId === project.id}
                  title={project.name}
                  onClick={(event) => props.onOpen(project.id, event)}
                >
                  <ViewSidebar.Icon>
                    <StackIcon />
                  </ViewSidebar.Icon>
                  <span class="truncate">{project.name}</span>
                </ViewSidebar.Item>
              )}
            </For>
            <Show when={source.loading()}>
              <ProjectsSidebarSkeleton />
            </Show>
            <Show when={failed()}>
              <p
                role="alert"
                class="px-(--sidebar-item-inset) py-2 text-xs text-ink-muted"
              >
                Could not load projects.
              </p>
              <ViewSidebar.Item
                disabled={pending()}
                onClick={() => void readProjects('refresh')}
              >
                Try again
              </ViewSidebar.Item>
            </Show>
            <Show
              when={
                !source.loading() && !failed() && source.rows()?.length === 0
              }
            >
              <p class="px-(--sidebar-item-inset) py-2 text-xs text-ink-muted">
                No projects yet
              </p>
            </Show>
            <Show when={source.hasMore() && !failed()}>
              <ViewSidebar.Item
                disabled={pending() || source.loadingMore()}
                onClick={() => void readProjects('more')}
              >
                {pending() || source.loadingMore()
                  ? 'Loading…'
                  : 'Load more projects'}
              </ViewSidebar.Item>
            </Show>
          </ViewSidebar.Nav>
        </Suspense>
      </CollapsibleSection.Content>
    </CollapsibleSection.Root>
  );
}
