import { QUERY_FILTERS_BASE } from '@app/component/next-soup/filters/query-filters';
import { TaskListEntity } from '@app/component/next-soup/soup-view/views/tasks/TaskListEntity';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { ENABLE_TASK_DUPLICATES_FLAG } from '@core/constant/featureFlags';
import { ListLayoutProvider } from '@entity';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CopyIcon from '@phosphor/copy.svg';
import { useSoupItemsQuery } from '@queries/soup/items';
import { useTaskSimilaritySearchQuery } from '@queries/storage/task-duplicates';
import type { TaskSimilarityResult } from '@service-storage/client';
import { debounce } from '@solid-primitives/scheduled';
import { cn } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  For,
  Show,
  Suspense,
} from 'solid-js';

const DEBOUNCE_MS = 300;

type DebouncedInput = { title: string; markdown: string };

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
    // Mirror the composer's create call, which does not share with a team.
    shareWithTeam: false,
  }));

  // The query retains its last data while disabled, so clear the results
  // ourselves once there is nothing to search on (no title and no body).
  const hasInput = () => {
    const input = props.debounced();
    return input.title.trim().length > 0 || input.markdown.trim().length > 0;
  };
  const results = (): TaskSimilarityResult[] =>
    hasInput() ? (similarity.data ?? []) : [];
  const ids = () => results().map((result) => result.taskId);

  // Hydrate full soup entities (status, owner, assignees, …) for the matches so
  // they render identically to the soup task list.
  const soup = useSoupItemsQuery(
    () => ({
      params: { limit: 25 },
      body: {
        ...QUERY_FILTERS_BASE,
        document_filters: { document_ids: ids(), sub_types: ['task'] },
      },
    }),
    () => ({ enabled: ids().length > 0, staleTime: 30 * 1000 })
  );

  // Keep the similarity ranking order.
  const entities = () => {
    const order = new Map(ids().map((id, index) => [id, index] as const));
    return [...(soup.data ?? [])]
      .filter((entity) => order.has(entity.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  };

  return (
    <Show when={entities().length > 0}>
      <div class="shrink-0 flex flex-col gap-0.5">
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
          <span>Possible duplicates</span>
        </button>
        <Show when={expanded()}>
          <ListLayoutProvider ref={listRef}>
            <div
              ref={setListRef}
              class="flex max-h-48 flex-col overflow-y-auto scrollbar-hidden"
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
  const flag = useFeatureFlag(ENABLE_TASK_DUPLICATES_FLAG);

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
    <Show when={flag().enabled}>
      <Suspense>
        <SimilarTasksInner
          debounced={debounced}
          onOpenTask={props.onOpenTask}
        />
      </Suspense>
    </Show>
  );
}
