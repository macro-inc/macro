import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { debouncedDependent } from '@core/util/debounce';
import CircleDashedEmpty from '@phosphor/circle-dashed.svg';
import LoadingSpinner from '@phosphor/spinner.svg';
import StackIcon from '@phosphor/stack.svg';
import {
  DropdownSearchInput,
  DropdownSelectableRow,
  useDropdownSearch,
} from '@property/editors/selectors/PropertyOptionSelector';
import { useSearchInputFocus } from '@property/utils';
import {
  createEffect,
  createMemo,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { useProjectsContext } from '../context/projects-context';
import { canEditProject } from '../core/project';

type PickerItem =
  | { type: 'clear' }
  | { type: 'project'; id: string; name: string };

/** Project list for the property popover, laid out like the select editor. */
export function ProjectPicker(props: {
  taskIds: readonly string[];
  onClose(): void;
}) {
  const context = useProjectsContext();
  const commands = context.createCommands();
  let searchInputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  const assign = async (projectId?: string) => {
    // The selection that owns these ids unmounts as soon as the picker closes.
    const taskIds = [...props.taskIds];
    // Close first like the other property editors; the save settles after.
    props.onClose();
    try {
      const results = await commands.assignTasks(projectId, taskIds);
      const failed = results.filter((item) => item.error);
      if (!failed.length) return;
      toast.failure(
        failed.length === 1
          ? 'Could not set project'
          : `${failed.length} tasks could not be updated`,
        { subtext: failed[0].error }
      );
    } catch (error) {
      toast.failure('Could not set project', {
        subtext: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const dropdown = useDropdownSearch({
    itemCount: () => items().length,
    onSelect: (index) => {
      const item = items()[index];
      if (item) void assign(item.type === 'project' ? item.id : undefined);
    },
    onClose: props.onClose,
  });

  const query = debouncedDependent(dropdown.searchQuery, 150);
  const source = context.createCollectionSource(() => ({
    query: query().trim() || undefined,
    sort: 'updated',
    descending: true,
  }));

  const items = createMemo<PickerItem[]>(() => {
    const projects: PickerItem[] = (source.rows() ?? [])
      .filter((row) => canEditProject(row.project))
      .map((row) => ({
        type: 'project',
        id: row.project.id,
        name: row.project.name,
      }));
    // Matches the select editor: the "no value" row only shows unsearched.
    return dropdown.searchQuery().trim()
      ? projects
      : [{ type: 'clear' }, ...projects];
  });

  createEffect(() => {
    const index = dropdown.selectedIndex();
    if (!dropdown.keyboardMode() || !listRef) return;
    listRef
      .querySelector(`[data-project-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  });

  const loadMoreNearEnd = (element: HTMLElement) => {
    if (!source.hasMore() || source.loadingMore()) return;
    // One row of slack so the next page lands before the list bottoms out.
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 32)
      void source.loadMore();
  };

  onMount(() => document.addEventListener('keydown', dropdown.handleKeyDown));
  onCleanup(() =>
    document.removeEventListener('keydown', dropdown.handleKeyDown)
  );

  useSearchInputFocus(() => searchInputRef);

  return (
    <div>
      <Show when={!isTouchDevice()}>
        <DropdownSearchInput
          value={dropdown.searchQuery()}
          inputRef={(element) => {
            searchInputRef = element;
          }}
          onInput={dropdown.setSearchQuery}
          placeholder="Add to project..."
        />
      </Show>
      <div class="p-1.5">
        <Switch>
          <Match when={source.error()}>
            <div role="alert" class="text-center py-4 text-ink-muted">
              Could not load projects
            </div>
          </Match>
          <Match when={source.loading() && !source.rows()?.length}>
            <div class="flex items-center justify-center py-8">
              <div class="w-5 h-5 animate-spin">
                <LoadingSpinner />
              </div>
              <span class="ml-2 text-ink-muted">Loading projects...</span>
            </div>
          </Match>
          <Match when={true}>
            <div
              ref={listRef}
              class="max-h-50 overflow-y-auto overflow-x-hidden scrollbar-hidden"
              onScroll={(event) => loadMoreNearEnd(event.currentTarget)}
            >
              <For each={items()}>
                {(item, index) => (
                  <div data-project-index={index()}>
                    <DropdownSelectableRow
                      isSelected={index() === dropdown.selectedIndex()}
                      onClick={() =>
                        void assign(
                          item.type === 'project' ? item.id : undefined
                        )
                      }
                      onMouseEnter={() => {
                        if (!dropdown.keyboardMode())
                          dropdown.setSelectedIndex(index());
                      }}
                      showHotkey={dropdown.shouldShowHotkeys() && index() <= 9}
                      hotkeyShortcut={`${index()}`}
                    >
                      <Show
                        when={item.type === 'project' && item}
                        fallback={
                          <>
                            <CircleDashedEmpty class="size-3 shrink-0 text-ink-extra-muted" />
                            <p class="flex-1 min-w-0 truncate text-ink-muted">
                              No project
                            </p>
                          </>
                        }
                      >
                        {(project) => (
                          <>
                            <StackIcon class="size-3 shrink-0" />
                            <p class="flex-1 min-w-0 truncate">
                              {project().name}
                            </p>
                          </>
                        )}
                      </Show>
                    </DropdownSelectableRow>
                  </div>
                )}
              </For>
              <Show
                when={
                  !source.loading() &&
                  !items().some((item) => item.type === 'project')
                }
              >
                <div class="text-center py-4 text-ink-muted">
                  {dropdown.searchQuery().trim()
                    ? 'No projects match your search'
                    : 'No projects available'}
                </div>
              </Show>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
