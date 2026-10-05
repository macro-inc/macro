/**
 * App adapter for the database page (RFC 02 §7): a "Forms" chip after the
 * table tabs listing the forms over the current table, and the creation of a
 * form over the table, offered here and in the "+ view" dialog. Creating
 * over an existing table needs database Owner; editors and viewers keep
 * navigation to the forms that exist. Mounted only while forms are on.
 */
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import ClipboardText from '@phosphor/clipboard-text.svg';
import Plus from '@phosphor/plus.svg';
import { createForm, useFormsForDatabaseQuery } from '@queries/storage/forms';
import { Dropdown } from '@ui';
import {
  type Accessor,
  createRenderEffect,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';

/** Make a form over an existing table and open it; resolves why it was refused, if it was. */
async function createFormOverTable(
  target: { databaseId: string; tableId: string; name: string },
  open: (formId: string) => void
): Promise<string | undefined> {
  const created = await createForm(
    {
      name: target.name,
      source: {
        kind: 'table',
        databaseId: target.databaseId,
        tableId: target.tableId,
      },
    },
    'database'
  );
  if (created.isErr()) {
    const [failure] = created.error;
    return `The form wasn’t created: ${failure?.refusal?.message ?? failure?.message ?? 'try again'}`;
  }
  open(created.value.form.id);
  return undefined;
}

/**
 * The "+ view" dialog's Form choice: offered to the database's owner while
 * no form writes to the table (with forms, the chip's menu makes more).
 */
export function useTableFormCreation(props: {
  databaseId: Accessor<string>;
  tableId: Accessor<string | undefined>;
  tableName: Accessor<string | undefined>;
  isOwner: Accessor<boolean>;
  enabled: Accessor<boolean>;
}): Accessor<NewFormChoice | undefined> {
  const { replaceOrInsertSplit } = useSplitLayout();
  const forms = useFormsForDatabaseQuery(() =>
    props.enabled() && props.isOwner() ? props.databaseId() : undefined
  );
  return () => {
    const tableId = props.tableId();
    if (!props.enabled() || !props.isOwner() || !tableId || !forms.isSuccess)
      return undefined;
    if (forms.data.some((form) => form.tableId === tableId)) return undefined;
    return {
      initialName: `${props.tableName() ?? 'Table'} form`,
      onCreate: (name) =>
        createFormOverTable(
          { databaseId: props.databaseId(), tableId, name },
          (formId) => replaceOrInsertSplit({ type: 'form', id: formId })
        ),
    };
  };
}

type NewFormChoice = {
  initialName: string;
  onCreate: (name: string) => Promise<string | undefined>;
};

/**
 * Hands the database page its "+ view" Form choice, so the page reaches
 * this feature only through a lazy import. Renders nothing.
 */
export function DatabaseFormCreation(props: {
  databaseId: string;
  tableId: string | undefined;
  tableName: string | undefined;
  isOwner: boolean;
  onChoice: (choice: NewFormChoice | undefined) => void;
}) {
  const choice = useTableFormCreation({
    databaseId: () => props.databaseId,
    tableId: () => props.tableId,
    tableName: () => props.tableName,
    isOwner: () => props.isOwner,
    enabled: () => true,
  });
  // Syncing out to the page that mounted this, not deriving local state.
  createRenderEffect(() => props.onChoice(choice()));
  onCleanup(() => props.onChoice(undefined));
  return null;
}

/**
 * The database share dialog's note on derived access (RFC 02 §6): each
 * form's editors hold Edit on this database, revoked from the form.
 */
export function DatabaseFormEditors(props: { databaseId: string }) {
  const forms = useFormsForDatabaseQuery(() => props.databaseId);
  const listed = () => (forms.isSuccess ? forms.data : []);
  const openSharing = (formId: string) =>
    globalSplitManager()?.openWithSplit(
      { type: 'form', id: formId, params: { view: 'share' } },
      { preferNewSplit: true, activate: true, referredFrom: null }
    );
  return (
    <Show when={listed().length > 0}>
      <div class="flex flex-col gap-1.5 rounded-lg border border-edge-muted bg-panel px-3 py-2 text-xs text-ink-muted">
        <p>
          Editors of these forms can also edit this database, its rows and
          columns. Change who edits a form in its sharing.
        </p>
        <ul class="flex flex-wrap gap-1.5">
          <For each={listed()}>
            {(form) => (
              <li>
                <button
                  type="button"
                  aria-label={`${form.name} sharing`}
                  class="inline-flex items-center gap-1 rounded-full border border-edge-muted px-2 py-0.5 text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-edge-focus"
                  onClick={() => openSharing(form.id)}
                >
                  <ClipboardText
                    class="size-3 text-violet"
                    aria-hidden="true"
                  />
                  {form.name}
                </button>
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  );
}

function DatabaseFormsMenu(props: {
  databaseId: string;
  tableId: string;
  tableName: string;
  canCreate: boolean;
}) {
  const { replaceOrInsertSplit } = useSplitLayout();
  const forms = useFormsForDatabaseQuery(() => props.databaseId);
  const [creating, setCreating] = createSignal(false);
  const onTable = () =>
    forms.isSuccess
      ? forms.data.filter((form) => form.tableId === props.tableId)
      : [];
  async function createFromTable() {
    if (creating()) return;
    setCreating(true);
    const refusal = await createFormOverTable(
      {
        databaseId: props.databaseId,
        tableId: props.tableId,
        name: `${props.tableName} form`,
      },
      (formId) => replaceOrInsertSplit({ type: 'form', id: formId })
    );
    setCreating(false);
    if (refusal) toast.failure(refusal);
  }
  return (
    <Show
      when={onTable().length > 0}
      fallback={
        <Show when={props.canCreate}>
          <button
            type="button"
            disabled={creating()}
            aria-busy={creating()}
            class="ml-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-edge-focus disabled:opacity-60"
            onClick={() => void createFromTable()}
          >
            <ClipboardText class="size-3.5 text-violet" aria-hidden="true" />
            <Plus class="size-3" aria-hidden="true" />
            Form
          </button>
        </Show>
      }
    >
      <Dropdown>
        <Dropdown.Trigger
          variant="outline"
          size="sm"
          class="ml-1 h-7 shrink-0 gap-1.5 px-2 text-xs"
          aria-label={`Forms over ${props.tableName}`}
        >
          <ClipboardText class="size-3.5 text-violet" />
          {onTable().length === 1 ? '1 form' : `${onTable().length} forms`}
        </Dropdown.Trigger>
        <Dropdown.Content class="w-64">
          <Dropdown.GroupLabel>
            Forms writing to {props.tableName}
          </Dropdown.GroupLabel>
          <For each={onTable()}>
            {(form) => (
              <Dropdown.Item
                onSelect={() =>
                  replaceOrInsertSplit({ type: 'form', id: form.id })
                }
              >
                <ClipboardText class="size-4 text-violet" />
                <span class="flex-1 truncate">{form.name}</span>
                <span class="text-xs text-ink-muted">
                  {form.status === 'closed' ? 'Closed' : 'Open'}
                </span>
              </Dropdown.Item>
            )}
          </For>
          <Show when={props.canCreate}>
            <Dropdown.Separator class="my-1 h-px bg-edge-divider" />
            <Dropdown.Item onSelect={() => void createFromTable()}>
              <Plus class="size-4" />
              <span class="flex-1">New form from this table</span>
            </Dropdown.Item>
          </Show>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}

export function DatabaseFormsEntry(props: {
  databaseId: string;
  tableId: string | undefined;
  tableName: string | undefined;
  /** Database Owner: only owners attach a form to an existing table. */
  canCreate: boolean;
  enabled: boolean;
}) {
  return (
    <Show
      when={props.enabled && props.tableId ? props.tableId : undefined}
      keyed
    >
      {(tableId) => (
        <DatabaseFormsMenu
          databaseId={props.databaseId}
          tableId={tableId}
          tableName={props.tableName ?? 'Table'}
          canCreate={props.canCreate}
        />
      )}
    </Show>
  );
}
