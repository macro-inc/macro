import { fireAndForget } from '@core/util/fireAndForget';
import EmptyStateNoFilterMatchGraphic from '@design/empty-state-no-filter-match.svg';
import PlusIcon from '@phosphor/plus.svg';
import type { DatabaseOpsError } from '@service-storage/databases';
import { Button } from '@ui/components/Button';
import type { Result } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { KanbanBoard } from '../../../components/kanban/kanban-board';
import { inferDatabaseNumber } from '../core/column-inference';
import { columnSchemaMessage } from '../core/column-schema';
import type { DatabaseViewColumn } from '../core/database-view';
import { isDatabaseNameTaken } from '../core/property-creation';

export function NewBoardGroup(props: {
  column: DatabaseViewColumn;
  onSave: (label: string) => Promise<Result<void, DatabaseOpsError>>;
}) {
  const [adding, setAdding] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  let input: HTMLInputElement | undefined;
  const cancel = () => {
    if (!pending()) {
      setAdding(false);
      setError('');
    }
  };
  async function save(event: SubmitEvent) {
    event.preventDefault();
    const entered = draft().trim();
    if (!entered || pending()) return;
    const number =
      props.column.dataType === 'SELECT_NUMBER'
        ? inferDatabaseNumber(entered)
        : undefined;
    if (props.column.dataType === 'SELECT_NUMBER' && number === undefined) {
      setError('Enter a valid number for this group.');
      return;
    }
    const label = number === undefined ? entered : String(number);
    if (
      isDatabaseNameTaken(
        label,
        props.column.options.map((option) => option.label)
      )
    ) {
      setError('A group with this name already exists.');
      return;
    }
    setPending(true);
    setError('');
    const added = await props.onSave(label);
    setPending(false);
    added.match(
      () => {
        setAdding(false);
        setDraft('');
      },
      (error) => setError(columnSchemaMessage(error))
    );
  }
  return (
    <KanbanBoard.ColumnPlaceholder aria-label="New group">
      <div aria-hidden="true" class="h-20 w-32 shrink-0 text-ink-extra-muted">
        <EmptyStateNoFilterMatchGraphic class="size-full" />
      </div>
      <Show
        when={adding()}
        fallback={
          <>
            <h2 class="text-sm font-medium">Create a group</h2>
            <Button
              size="sm"
              variant="outline"
              class="gap-2"
              onClick={() => {
                setDraft('');
                setAdding(true);
                queueMicrotask(() => input?.focus());
              }}
            >
              <PlusIcon class="size-3.5" />
              New group
            </Button>
          </>
        }
      >
        <form
          class="w-full text-left"
          onSubmit={(event) => fireAndForget(save(event), 'database')}
        >
          <p class="mb-2 block text-xs font-medium text-ink-muted">
            New {props.column.name.toLowerCase()} group
          </p>
          <input
            ref={input}
            value={draft()}
            maxlength={200}
            aria-label="New group name"
            placeholder={
              props.column.dataType === 'SELECT_NUMBER'
                ? 'Enter a number…'
                : 'Group name…'
            }
            readOnly={pending()}
            class="w-full rounded-md border border-edge-muted bg-input px-2.5 py-2 text-xs outline-none focus:border-ink/50"
            onInput={(event) => {
              setDraft(event.currentTarget.value);
              setError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
              }
            }}
          />
          <Show when={error()}>
            <p role="alert" class="mt-2 text-xs leading-5 text-failure-ink">
              {error()}
            </p>
          </Show>
          <div class="mt-3 flex items-center justify-end gap-2">
            <Button size="sm" disabled={pending()} onClick={cancel}>
              Cancel
            </Button>
            <Button
              size="sm"
              type="submit"
              variant="cta"
              disabled={pending() || !draft().trim()}
            >
              {pending() ? 'Adding…' : 'Add group'}
            </Button>
          </div>
        </form>
      </Show>
    </KanbanBoard.ColumnPlaceholder>
  );
}
