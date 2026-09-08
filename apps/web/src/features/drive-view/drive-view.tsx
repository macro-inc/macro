import { ViewShell } from '@app/components/view-shell';
import { ViewFavorites } from '@app/features/favorites/view-favorites';
import {
  buildDocumentTypeQuery,
  getActiveDocumentTypeFilterIds,
} from '@app/features/next-soup/filters/configs/document-type-query';
import { SoupActiveFiltersBar } from '@app/features/next-soup/soup-view/filters-bar/soup-active-filters-bar';
import { SoupViewContextSort } from '@app/features/next-soup/soup-view/filters-bar/soup-view-context-sort';
import { SoupSearchbar } from '@app/features/next-soup/soup-view/filters-bar/soup-view-search-bar';
import { useFilterRefinements } from '@app/features/next-soup/soup-view/filters-bar/use-filter-refinements';
import { SoupView } from '@app/features/next-soup/soup-view/soup-view';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { SoupViewCreateButton } from '@app/features/next-soup/soup-view/soup-view-create-button';
import { useApplyPreset } from '@app/features/next-soup/soup-view/soup-view-tabs';
import { SplitPanel } from '@components/app/split-panel';
import ClockIcon from '@phosphor/clock.svg';
import FilePdfIcon from '@phosphor/file-pdf.svg';
import FileTextIcon from '@phosphor/file-text.svg';
import FilesIcon from '@phosphor/files.svg';
import ImageIcon from '@phosphor/image.svg';
import CanvasIcon from '@phosphor/squares-four.svg';
import UsersIcon from '@phosphor/users.svg';
import VideoIcon from '@phosphor/video-camera.svg';
import { useProjectsQuery } from '@queries/storage/projects';
import { Button, cn } from '@ui';
import { batch, type ComponentProps, createMemo, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { DriveFolderTree } from './DriveFolderTree';
import { buildFolderTree } from './folder-tree';

const TABS = [
  { id: 'owned', label: 'My Files', icon: FilesIcon },
  { id: 'recent', label: 'Recent', icon: ClockIcon },
  { id: 'shared', label: 'Shared with me', icon: UsersIcon },
];
const TYPES = [
  {
    label: 'Documents',
    icon: FileTextIcon,
    ids: ['doc-markdown', 'file-docx'],
  },
  { label: 'PDF', icon: FilePdfIcon, ids: ['file-pdf'] },
  { label: 'Video', icon: VideoIcon, ids: ['file-video'] },
  { label: 'Image', icon: ImageIcon, ids: ['file-image'] },
  { label: 'Canvas', icon: CanvasIcon, ids: ['doc-canvas'] },
];

/** Drive keeps file navigation and filters beside the existing Soup list. */
export function DriveView(props: ComponentProps<typeof SoupView>) {
  const view = useSoupView();
  const { applyTabPreset } = useApplyPreset();
  const refinements = useFilterRefinements();
  const projects = useProjectsQuery();
  const folders = () => (projects.isSuccess ? projects.data : []);
  const tree = createMemo(() => buildFolderTree(folders()));
  const folderId = () => view.queryFilters.state.include.projectId?.[0];
  const title = () =>
    folderId()
      ? (folders().find((folder) => folder.id === folderId())?.name ?? 'Folder')
      : (TABS.find((tab) => tab.id === (view.activeTab() ?? 'owned'))?.label ??
        'Drive');
  const navigate = (tab: string, folder?: string) =>
    batch(() => {
      view.queryFilters.set({ include: { projectId: undefined } });
      applyTabPreset('documents', tab);
      view.queryFilters.set({
        include: { projectId: folder ? [folder] : undefined },
      });
      view.soup.sort.setAll([tab === 'recent' ? 'viewed_at' : 'updated_at']);
    });
  const toggleType = (ids: string[]) =>
    batch(() => {
      const before = buildDocumentTypeQuery(
        getActiveDocumentTypeFilterIds(view.soup.predicates.isActive)
      );
      const selected = ids.every(view.soup.predicates.isActive);
      for (const id of ids) {
        if (view.soup.predicates.isActive(id) === selected)
          view.soup.predicates.toggle({ or: [id] });
      }
      const after = buildDocumentTypeQuery(
        getActiveDocumentTypeFilterIds(view.soup.predicates.isActive)
      );
      if (before) view.queryFilters.remove(before);
      if (after) view.queryFilters.add(after);
    });
  const header = () => (
    <>
      <header class="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-edge-muted px-4">
        <h2 class="truncate text-sm font-semibold text-ink">{title()}</h2>
        <div class="min-w-0 max-w-80 flex-1">
          <SoupSearchbar
            placeholder="Search files"
            class="h-9 gap-2 px-3 py-1.5"
          />
        </div>
      </header>
      <div
        class="relative flex shrink-0 flex-wrap items-center gap-2 px-4 py-2"
        aria-label="File type filters"
      >
        <For each={TYPES}>
          {(type) => (
            <Button
              variant="outline"
              size="sm"
              class={cn(
                'h-8 gap-2 rounded-lg border-edge-muted bg-ink/3 px-3 text-sm',
                type.ids.every(view.soup.predicates.isActive) &&
                  'bg-active text-ink'
              )}
              aria-pressed={type.ids.every(view.soup.predicates.isActive)}
              onClick={() => toggleType(type.ids)}
            >
              <Dynamic component={type.icon} class="size-3.5" />
              {type.label}
            </Button>
          )}
        </For>
        <div class="ml-auto shrink-0 [&_button]:h-8 [&_button]:gap-2 [&_button]:px-3 [&_button]:text-sm [&_button>svg]:size-3.5">
          <SoupViewContextSort />
        </div>
        <div
          aria-hidden="true"
          class="pointer-events-none absolute -left-2 right-0 bottom-0 border-b border-edge-muted"
        />
      </div>
      <SoupActiveFiltersBar
        filters={refinements.consolidatedFiltersList()}
        onClearAll={refinements.resetToTabDefaults}
      />
    </>
  );
  return (
    <SplitPanel.Root>
      <SplitPanel.Body>
        <ViewShell.Root
          resizable
          aside={{ width: 288, min: 224, max: 360 }}
          breakpoints={{ collapsed: 0 }}
          layoutBreakpoint="collapsed"
          main={{ min: 280 }}
        >
          <ViewShell.Aside>
            <aside
              aria-label="Drive navigation"
              class="flex size-full min-h-0 flex-col border-r border-edge-muted bg-sidebar"
            >
              <header class="flex h-12 shrink-0 items-center border-b border-edge-muted px-5">
                <h1 class="text-xl font-semibold tracking-tight text-ink">
                  Drive
                </h1>
              </header>
              <div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 py-4">
                <div class="w-full [&>div]:w-full">
                  <SoupViewCreateButton sidebar />
                </div>
                <nav aria-label="Files">
                  <For each={TABS}>
                    {(tab) => (
                      <Button
                        variant="ghost"
                        class={cn(
                          'h-9 w-full justify-start gap-3 rounded-xl px-3 font-normal',
                          !folderId() &&
                            (view.activeTab() ?? 'owned') === tab.id &&
                            'bg-active text-ink'
                        )}
                        aria-current={
                          !folderId() &&
                          (view.activeTab() ?? 'owned') === tab.id
                            ? 'page'
                            : undefined
                        }
                        onClick={() => navigate(tab.id)}
                      >
                        <Dynamic component={tab.icon} class="size-4 shrink-0" />
                        {tab.label}
                      </Button>
                    )}
                  </For>
                </nav>
                <ViewFavorites view="documents" />
                <section aria-label="Folders" class="min-h-0 shrink-0">
                  <h2 class="mb-2 px-3 text-xs font-medium text-ink-subtle">
                    Folders
                  </h2>
                  <DriveFolderTree
                    nodes={tree()}
                    selected={folderId()}
                    rootActive={view.activeTab() === 'all' && !folderId()}
                    onSelect={(id) => navigate('all', id)}
                  />
                  <Show when={projects.isPending}>
                    <p class="px-3 py-2 text-xs text-ink-muted">
                      Loading folders…
                    </p>
                  </Show>
                  <Show when={projects.isError}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => projects.refetch()}
                    >
                      Retry loading folders
                    </Button>
                  </Show>
                </section>
              </div>
            </aside>
          </ViewShell.Aside>
          <ViewShell.Main>
            <SoupView {...props} viewName="Drive" header={header()} />
          </ViewShell.Main>
          <div
            aria-hidden="true"
            class="pointer-events-none absolute inset-x-0 top-0 z-10 h-12 border-b border-edge-muted"
          />
        </ViewShell.Root>
      </SplitPanel.Body>
    </SplitPanel.Root>
  );
}
