import { SearchBar } from '@app/components/view-shell';
import { debouncedDependent } from '@core/util/debounce';
import StackIcon from '@phosphor/stack.svg';
import { Button, Dialog } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { useProjectsContext } from '../context/projects-context';

export function ProjectAssignment(props: {
  taskIds: readonly string[];
  onClose(): void;
}) {
  const context = useProjectsContext();
  const [search, setSearch] = createSignal('');
  const query = debouncedDependent(search, 150);
  const source = context.createCollectionSource(() => ({
    query: query().trim() || undefined,
    sort: 'updated',
    descending: true,
  }));
  const commands = context.createCommands();
  const close = () => {
    if (!commands.pending()) props.onClose();
  };
  const [remaining, setRemaining] = createSignal<readonly string[]>(
    props.taskIds
  );
  const [error, setError] = createSignal<string>();
  const assign = async (projectId?: string) => {
    setError(undefined);
    try {
      const results = await commands.assignTasks(projectId, remaining());
      const failed = results.filter((item) => item.error);
      if (!failed.length) {
        props.onClose();
        return;
      }
      setRemaining(failed.map((item) => item.taskId));
      setError(
        `${failed.length} tasks could not be updated. ${failed[0].error}`
      );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not set project.'
      );
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      class="max-w-lg"
    >
      <div class="flex flex-col gap-3 p-4">
        <Dialog.Title>
          Set project
          {remaining().length > 1 ? ` for ${remaining().length} tasks` : ''}
        </Dialog.Title>
        <SearchBar
          label="Search projects"
          placeholder="Search projects"
          value={search()}
          onValueChange={setSearch}
          onEscape={close}
        />
        <Button
          class="justify-start"
          disabled={commands.pending()}
          onClick={() => void assign()}
        >
          No project
        </Button>
        <div class="max-h-80 overflow-y-auto">
          <For each={source.rows()}>
            {(row) => (
              <Button
                class="w-full justify-start"
                disabled={
                  commands.pending() ||
                  (row.project.access !== 'edit' &&
                    row.project.access !== 'owner')
                }
                onClick={() => void assign(row.project.id)}
              >
                <StackIcon class="size-4 shrink-0" />
                <span class="truncate">{row.project.name}</span>
                <Show
                  when={
                    row.project.access !== 'edit' &&
                    row.project.access !== 'owner'
                  }
                >
                  <span class="ml-auto text-xs text-ink-muted">Read only</span>
                </Show>
              </Button>
            )}
          </For>
        </div>
        <Show when={source.loading()}>
          <p role="status" class="text-sm text-ink-muted">
            Loading projects…
          </p>
        </Show>
        <Show when={source.error()}>
          <p role="alert" class="text-sm text-failure">
            Could not load projects.
          </p>
          <Button onClick={() => void source.refresh()}>Try again</Button>
        </Show>
        <Show
          when={
            !source.loading() && !source.error() && source.rows()?.length === 0
          }
        >
          <p class="py-4 text-center text-sm text-ink-muted">
            No matching projects
          </p>
        </Show>
        <Show when={source.hasMore()}>
          <Button
            disabled={source.loadingMore()}
            onClick={() => void source.loadMore()}
          >
            Load more projects
          </Button>
        </Show>
        <Show when={error()}>
          {(error) => (
            <p role="alert" class="text-sm text-failure">
              {error()}
            </p>
          )}
        </Show>
        <Show when={commands.pending()}>
          <p role="status" class="text-sm text-ink-muted">
            Updating tasks…
          </p>
        </Show>
        <div class="flex justify-end">
          <Button disabled={commands.pending()} onClick={close}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
