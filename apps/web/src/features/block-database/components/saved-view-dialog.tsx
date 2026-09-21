import KanbanIcon from '@phosphor/kanban.svg';
import TableIcon from '@phosphor/table.svg';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { Panel } from '@ui/components/Panel';
import { createSignal, Show } from 'solid-js';
import {
  type DatabaseViewColumn,
  type DatabaseViewConfig,
  isBoardGroupColumn,
} from '../core/database-view';
import { ViewSelect } from './view-select';

export function SaveViewDialog(props: {
  mode: 'save' | 'rename' | 'delete';
  initialName: string;
  initialLayout?: DatabaseViewConfig['layout'];
  initialGroupBy?: string | null;
  columns?: DatabaseViewColumn[];
  onSubmit: (
    name: string,
    layout: DatabaseViewConfig['layout'],
    groupBy?: string | null
  ) => Promise<void>;
  onClose: () => void;
  returnFocus?: HTMLElement;
  returnFocusFallback?: HTMLElement;
}) {
  let nameInput: HTMLInputElement | undefined;
  const [name, setName] = createSignal(props.initialName);
  const [layout, setLayout] = createSignal<DatabaseViewConfig['layout']>(
    props.initialLayout ?? 'table'
  );
  const groups = () => (props.columns ?? []).filter(isBoardGroupColumn);
  const [groupBy, setGroupBy] = createSignal(
    props.initialGroupBy ?? groups()[0]?.id ?? null
  );
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (
      pending() ||
      !name().trim() ||
      (props.mode === 'save' && layout() === 'board' && !groupBy())
    )
      return;
    setPending(true);
    setError('');
    try {
      await props.onSubmit(
        name().trim(),
        layout(),
        layout() === 'board' ? groupBy() : undefined
      );
      props.onClose();
    } catch {
      setError('Could not save this change. Please try again.');
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !pending() && props.onClose()}
      onOpenAutoFocus={(event) => {
        if (props.mode === 'delete') return;
        event.preventDefault();
        nameInput?.focus();
        nameInput?.select();
      }}
      onCloseAutoFocus={(event) => {
        const target = props.returnFocus?.isConnected
          ? props.returnFocus
          : props.returnFocusFallback;
        if (target?.isConnected) {
          event.preventDefault();
          target.focus();
        }
      }}
      class="w-100 max-w-[calc(100vw-2rem)]"
    >
      <Panel>
        <Panel.Body>
          <form class="flex flex-col gap-4 p-5" onSubmit={submit}>
            <Dialog.Title class="text-base font-semibold text-ink">
              {props.mode === 'delete'
                ? 'Delete saved view?'
                : props.mode === 'rename'
                  ? 'Rename view'
                  : 'New view'}
            </Dialog.Title>
            <Dialog.Description class="text-sm leading-relaxed text-ink-muted">
              {props.mode === 'delete'
                ? `“${props.initialName}” will be removed from your saved views. The table and its records will stay.`
                : props.mode === 'rename'
                  ? 'Give this view a name that is easy to find.'
                  : 'See the same records in a different way. Views are saved just for you.'}
            </Dialog.Description>
            <Show when={props.mode === 'save'}>
              <div
                class="grid grid-cols-2 gap-2"
                role="group"
                aria-label="View layout"
              >
                <button
                  type="button"
                  disabled={pending()}
                  aria-pressed={layout() === 'table'}
                  onClick={() => {
                    setLayout('table');
                    if (name() === 'Board view') setName('Table view');
                  }}
                  class="flex flex-col gap-2 rounded-lg border p-3 text-left text-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
                  classList={{
                    'border-edge bg-hover': layout() === 'table',
                    'border-edge-muted': layout() !== 'table',
                  }}
                >
                  <TableIcon class="size-5 text-ink-muted" />
                  <span class="font-medium">Table</span>
                  <span class="text-xs text-ink-muted">Rows and columns</span>
                </button>
                <button
                  type="button"
                  disabled={pending()}
                  aria-pressed={layout() === 'board'}
                  onClick={() => {
                    setLayout('board');
                    if (name() === 'Table view') setName('Board view');
                  }}
                  class="flex flex-col gap-2 rounded-lg border p-3 text-left text-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
                  classList={{
                    'border-edge bg-hover': layout() === 'board',
                    'border-edge-muted': layout() !== 'board',
                  }}
                >
                  <KanbanIcon class="size-5 text-ink-muted" />
                  <span class="font-medium">Board</span>
                  <span class="text-xs text-ink-muted">
                    Cards grouped by a column
                  </span>
                </button>
              </div>
            </Show>
            <Show when={props.mode === 'save' && layout() === 'board'}>
              <div class="flex items-center gap-3 text-xs text-ink-muted">
                <span>Group by</span>
                <ViewSelect
                  label="Group board by"
                  value={groupBy() ?? ''}
                  options={groups().map((column) => ({
                    value: column.id,
                    label: column.name,
                  }))}
                  onChange={setGroupBy}
                  placeholder="Choose a column"
                />
              </div>
              <Show when={!groups().length}>
                <p class="text-xs text-ink-muted">
                  Add a Select or Checkbox column to group cards.
                </p>
              </Show>
            </Show>
            <Show when={props.mode !== 'delete'}>
              <label class="flex flex-col gap-1.5 text-xs font-medium text-ink-muted">
                View name
                <input
                  ref={nameInput}
                  required
                  maxlength={100}
                  readOnly={pending()}
                  value={name()}
                  onFocus={(event) => event.currentTarget.select()}
                  onInput={(event) => setName(event.currentTarget.value)}
                  placeholder="e.g. In progress"
                  class="h-10 rounded-lg border border-edge-muted bg-input px-3 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-ink/50"
                />
              </label>
            </Show>
            <Show when={error()}>
              <p role="alert" class="text-xs text-failure">
                {error()}
              </p>
            </Show>
            <div class="flex justify-end gap-2">
              <Button
                variant="ghost"
                disabled={pending()}
                onClick={props.onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant={props.mode === 'delete' ? 'danger' : 'cta'}
                disabled={
                  pending() ||
                  !name().trim() ||
                  (props.mode === 'save' && layout() === 'board' && !groupBy())
                }
              >
                {pending()
                  ? 'Saving…'
                  : props.mode === 'delete'
                    ? 'Delete view'
                    : props.mode === 'save'
                      ? 'Create view'
                      : 'Save name'}
              </Button>
            </div>
          </form>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
