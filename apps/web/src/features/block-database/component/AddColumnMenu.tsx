import { toast } from '@core/component/Toast/Toast';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { createDatabaseColumn } from '@queries/storage/databases';
import type { DataType } from '@service-properties/generated/schemas/dataType';
import type { DatabaseColumnDetail } from '@service-storage/databases';
import { Button, CommandMenuShell, Dialog, Dropdown, Tooltip } from '@ui';
import { createSignal, For, Show } from 'solid-js';

type AddColumnMenuProps = {
  databaseId: string;
  tableId: string;
  /** Existing columns, so a new one is not named over an old one. */
  columns: DatabaseColumnDetail[];
};

/**
 * Column types offered at the header's `+`. Links and lookups are a separate,
 * later affordance — they need a target picker, not a type list.
 */
const COLUMN_TYPES: { label: string; dataType: DataType }[] = [
  { label: 'Text', dataType: 'STRING' },
  { label: 'Number', dataType: 'NUMBER' },
  { label: 'Checkbox', dataType: 'BOOLEAN' },
  { label: 'Date', dataType: 'DATE' },
  { label: 'Select', dataType: 'SELECT_STRING' },
  { label: 'Link', dataType: 'LINK' },
];

/** The label the select form is reached by, and the name it starts from. */
const SELECT_LABEL = 'Select';

const inputClass =
  'w-full min-w-0 rounded-md border border-edge-muted bg-surface px-3 py-2 text-ink text-sm outline-none placeholder:text-ink-placeholder focus:border-accent';

/**
 * First free `Text`, `Text 2`, `Text 3`… for a type's label.
 *
 * Without this, two text columns are both named "Text" and only their SQL
 * names (`text`, `text_2`) tell them apart — and there is no rename-column
 * endpoint yet to recover from it.
 */
function uniqueColumnName(label: string, taken: string[]): string {
  const used = new Set(taken);
  if (!used.has(label)) return label;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${label} ${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Read a typed-in option list.
 *
 * One per line is the shape the field advertises, but a pasted comma-separated
 * list is the other thing people reach for, so both split.
 */
function parseOptionLabels(text: string): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const raw of text.split(/[\n,]/)) {
    const label = raw.trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

export function AddColumnMenu(props: AddColumnMenuProps) {
  const [pending, setPending] = createSignal(false);
  const [selectFormOpen, setSelectFormOpen] = createSignal(false);
  const [selectName, setSelectName] = createSignal('');
  const [selectOptionsText, setSelectOptionsText] = createSignal('');

  const takenNames = () =>
    props.columns.map((column) => column.definition.definition.display_name);

  const addColumn = async (
    name: string,
    dataType: DataType,
    options?: string[]
  ) => {
    if (pending()) return;
    setPending(true);
    const columnId = await createDatabaseColumn({
      databaseId: props.databaseId,
      tableId: props.tableId,
      request: {
        binding: {
          kind: 'new',
          name,
          data_type: dataType,
          is_multi_select: false,
          ...(options?.length ? { options } : {}),
        },
      },
    });
    setPending(false);
    if (!columnId) toast.failure('Could not add that column');
    return columnId;
  };

  const openSelectForm = () => {
    setSelectName(uniqueColumnName(SELECT_LABEL, takenNames()));
    setSelectOptionsText('');
    setSelectFormOpen(true);
  };

  const canSubmitSelect = () => selectName().trim().length > 0 && !pending();

  const submitSelect = async () => {
    if (!canSubmitSelect()) return;
    const columnId = await addColumn(
      selectName().trim(),
      'SELECT_STRING',
      parseOptionLabels(selectOptionsText())
    );
    if (columnId) setSelectFormOpen(false);
  };

  return (
    <>
      <Dropdown>
        <Tooltip label="Add column">
          <Dropdown.Trigger
            as={Button}
            variant="ghost"
            size="sm"
            class="size-6 p-0"
            aria-label="Add column"
          >
            <PlusIcon class="size-3" />
          </Dropdown.Trigger>
        </Tooltip>
        <Dropdown.Content>
          <Dropdown.Group>
            <Dropdown.GroupLabel>New column</Dropdown.GroupLabel>
            <For each={COLUMN_TYPES}>
              {(type) => (
                <Dropdown.Item
                  onSelect={() =>
                    // A select column is only usable once it has options, and
                    // there is no add-option affordance on an empty dropdown,
                    // so it asks up front instead of creating a dead column.
                    type.dataType === 'SELECT_STRING'
                      ? openSelectForm()
                      : addColumn(
                          uniqueColumnName(type.label, takenNames()),
                          type.dataType
                        )
                  }
                >
                  {type.label}
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>

      <Dialog
        open={selectFormOpen()}
        onOpenChange={(open) => {
          if (!open && !pending()) setSelectFormOpen(false);
        }}
        position="center"
        class="w-100"
      >
        <CommandMenuShell depth={2}>
          <CommandMenuShell.Header class="h-13 gap-3 border-b-0 px-4">
            <Dialog.Title
              as="span"
              class="min-w-0 flex-1 truncate font-semibold text-ink-extra-muted text-sm"
            >
              New select column
            </Dialog.Title>
            <Dialog.CloseButton
              as={Button}
              variant="ghost"
              size="icon-sm"
              disabled={pending()}
              label="Close"
            >
              <XIcon />
            </Dialog.CloseButton>
          </CommandMenuShell.Header>

          <CommandMenuShell.Body>
            <div class="flex flex-col gap-4 bg-surface px-4 pt-1 pb-4">
              <label class="flex flex-col gap-1.5">
                <span class="font-medium text-ink-extra-muted text-xs">
                  Name
                </span>
                <input
                  autofocus
                  type="text"
                  value={selectName()}
                  onInput={(event) => setSelectName(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      submitSelect();
                    }
                  }}
                  placeholder="Column name"
                  class={inputClass}
                />
              </label>

              <label class="flex flex-col gap-1.5">
                <span class="font-medium text-ink-extra-muted text-xs">
                  Options
                </span>
                <textarea
                  rows={4}
                  value={selectOptionsText()}
                  onInput={(event) =>
                    setSelectOptionsText(event.currentTarget.value)
                  }
                  placeholder={'Not started\nIn progress\nDone'}
                  class={inputClass}
                />
                <span class="text-ink-extra-muted text-xs">
                  One per line. More can be added from any cell later.
                </span>
              </label>
            </div>
          </CommandMenuShell.Body>

          <CommandMenuShell.Footer class="justify-end gap-2 py-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={pending()}
              onClick={() => setSelectFormOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="cta"
              size="sm"
              disabled={!canSubmitSelect()}
              onClick={submitSelect}
            >
              <Show when={pending()} fallback="Add column">
                Adding…
              </Show>
            </Button>
          </CommandMenuShell.Footer>
        </CommandMenuShell>
      </Dialog>
    </>
  );
}
