import {
  compileToAst,
  defineQueryFilters,
  queryStateFrom,
} from '@app/features/next-soup/filters/filter-store';
import { TaskListEntity } from '@app/features/next-soup/soup-view/views/tasks/TaskListEntity';
import { ListLayoutProvider } from '@entity';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import { TagSetsQueryProvider } from '@property/tags/tag-sets-context';
import {
  type SoupAstItemsQueryArgs,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { useTaskSimilaritySearchQuery } from '@queries/storage/task-duplicates';
import type { TaskSimilarityResult } from '@service-storage/client';
import { debounce } from '@solid-primitives/scheduled';
import { cn } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  Suspense,
} from 'solid-js';

const DEBOUNCE_MS = 300;
const MAX_SIMILAR_TASKS = 2;

type DebouncedInput = { title: string; markdown: string };

/** The given tasks, read in full so they render like the task list. */
export function taskDuplicatesArgs(taskIds: string[]): SoupAstItemsQueryArgs {
  return {
    params: { limit: 25 },
    body: compileToAst(
      queryStateFrom(
        defineQueryFilters({
          include: { documentId: taskIds, subType: ['task'] },
        })
      )
    ),
  };
}

/**
 * Inner component: lives inside the local `<Suspense>` so every read of query
 * data (similarity + soup) is contained here and a pending fetch suspends only
 * this subtree instead of bubbling up and remounting the composer.
 */
function SimilarTasksInner(props: {
  debounced: Accessor<DebouncedInput>;
  onOpenTask: (taskId: string) => void;
}) {
  const [expanded, setExpanded] = createSignal(true);
  const [listRef, setListRef] = createSignal<HTMLElement>();

  const similarity = useTaskSimilaritySearchQuery(() => ({
    title: props.debounced().title,
    markdown: props.debounced().markdown,
  }));

  // The query retains its last data while disabled, so clear the results
  // ourselves once there is nothing to search on (no title and no body).
  const hasInput = () => {
    const input = props.debounced();
    return input.title.trim().length > 0 || input.markdown.trim().length > 0;
  };
  const results = (): TaskSimilarityResult[] =>
    hasInput() ? (similarity.data ?? []).slice(0, MAX_SIMILAR_TASKS) : [];
  const ids = () => results().map((result) => result.taskId);

  // Hydrate full soup entities (status, owner, assignees, …) for the matches so
  // they render identically to the soup task list.
  const soup = useSoupAstItemsQuery(
    () => taskDuplicatesArgs(ids()),
    // Keep the shown matches while the next ids load, so the section never
    // collapses between keystrokes.
    () => ({ enabled: ids().length > 0, keepPreviousData: true })
  );

  // A page and the ranking it was read for. Only a newly arrived page takes the
  // current ranking; while the next page loads, the previous page keeps its
  // own, so the section never collapses between keystrokes.
  const shown = createMemo<{ page?: typeof soup.data; ids: string[] }>(
    (previous) => {
      if (ids().length === 0) return { ids: [] };
      const page = soup.data;
      if (!page || soup.isPlaceholderData || page === previous.page)
        return previous;
      return { page, ids: ids() };
    },
    { ids: [] }
  );

  // Keep the similarity ranking order.
  const entities = () => {
    const { page, ids: ranking } = shown();
    const order = new Map(ranking.map((id, index) => [id, index] as const));
    return [...(page?.entities ?? [])]
      .filter((entity) => order.has(entity.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  };

  return (
    <Show when={entities().length > 0}>
      <div class="-mx-4 shrink-0 flex flex-col gap-0.5 border-t border-edge-muted px-4 pt-3">
        <button
          type="button"
          class="flex items-center gap-1.5 px-1.5 py-1 text-xs font-medium text-ink-muted hover:text-ink"
          onClick={() => setExpanded((value) => !value)}
        >
          <CaretRightIcon
            class={cn(
              'size-3 shrink-0 transition-transform duration-90',
              expanded() && 'rotate-90'
            )}
          />
          <CopyIcon class="size-3.5 shrink-0" />
          <span>Similar Tasks</span>
        </button>
        <Show when={expanded()}>
          <TagSetsQueryProvider>
            <ListLayoutProvider ref={listRef}>
              {/* Named `u-list` container so the task rows pick up the narrow
                  (<=840px) container queries and collapse status/priority/
                  assignee pills to icons, leaving the width for task names. */}
              <div
                ref={setListRef}
                class="@container/u-list flex max-h-48 flex-col overflow-y-auto scrollbar-hidden"
              >
                <For each={entities()}>
                  {(entity) => (
                    <TaskListEntity
                      entity={entity}
                      hideCheckbox
                      onClick={() => props.onOpenTask(entity.id)}
                    />
                  )}
                </For>
              </div>
            </ListLayoutProvider>
          </TagSetsQueryProvider>
        </Show>
      </div>
    </Show>
  );
}

/**
 * Live "Possible duplicates" section for the task composer. As the user types,
 * it debounces the draft title/body and runs an ephemeral similarity search
 * against existing tasks (no vectors or matches are persisted), rendering hits
 * as soup-style task rows under a collapsible header.
 */
export function SimilarTasksSection(props: {
  title: Accessor<string>;
  content: Accessor<string>;
  onOpenTask: (taskId: string) => void;
}) {
  const [debounced, setDebounced] = createSignal<DebouncedInput>({
    title: props.title(),
    markdown: props.content(),
  });

  const updateDebounced = debounce(
    (next: DebouncedInput) => setDebounced(next),
    DEBOUNCE_MS
  );

  createEffect(() => {
    updateDebounced({ title: props.title(), markdown: props.content() });
  });

  return (
    <Suspense>
      <SimilarTasksInner debounced={debounced} onOpenTask={props.onOpenTask} />
    </Suspense>
  );
}
