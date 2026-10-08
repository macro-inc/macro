import { createSignal } from 'solid-js';
import { tableCreateMessage } from '../core/column-schema';
import { isDatabaseNameTaken } from '../core/property-creation';
import type { CreateTable } from '../core/table-creation';

export function NewTableTab(props: {
  existingNames: string[];
  onCreate: CreateTable;
  onOpenTable: (tableId: string) => void;
  onClose: (restoreFocus: boolean) => void;
  onError: (message: string) => void;
  onCreated: (tableId: string) => void;
  errorId: string;
}) {
  const [name, setName] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const setError = props.onError;
  const [createdTableId, setCreatedTableId] = createSignal<string>();
  const duplicate = () =>
    !createdTableId() &&
    name().trim() &&
    isDatabaseNameTaken(name(), props.existingNames);

  const openTable = (tableId: string) => {
    props.onOpenTable(tableId);
    props.onClose(false);
  };
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (pending()) return;
    if (!name().trim()) return;
    if (duplicate()) {
      setError('A table with this name already exists. Try another name.');
      return;
    }
    setPending(true);
    setError('');
    const created = await props.onCreate(name().trim(), createdTableId());
    setPending(false);
    created.match(
      (result) => {
        if (result.ready) openTable(result.tableId);
        else {
          setCreatedTableId(result.tableId);
          props.onCreated(result.tableId);
          setError(result.message);
        }
      },
      (errors) => setError(tableCreateMessage(errors))
    );
  };

  return (
    <form
      class="flex h-6 shrink-0 items-center rounded-full bg-input px-3 ring-1 ring-inset ring-edge-muted"
      aria-label="New table"
      onSubmit={submit}
      aria-busy={pending()}
    >
      <input
        aria-label="Table name"
        placeholder="Table name"
        class="w-32 min-w-0 bg-transparent text-xs font-medium text-ink outline-none placeholder:text-ink-placeholder"
        value={name()}
        maxLength={200}
        readOnly={pending() || !!createdTableId()}
        aria-invalid={!!duplicate()}
        aria-describedby={props.errorId}
        onFocusIn={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onInput={(event) => {
          setName(event.currentTarget.value);
          setError('');
        }}
        onBlur={(event) => {
          event.stopPropagation();
          if (pending()) return;
          if (!name().trim()) props.onClose(false);
          else event.currentTarget.form?.requestSubmit();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.isComposing || event.keyCode === 229) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            if (!pending()) props.onClose(true);
          }
        }}
      />
    </form>
  );
}
