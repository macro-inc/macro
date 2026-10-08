/**
 * App adapter for the database page (RFC 02 §7): the table selector’s add menu
 * lists forms over the current table and offers form creation. Creating
 * over an existing table needs database Owner; editors and viewers keep
 * navigation to the forms that exist. Mounted only while forms are on.
 */
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import ClipboardText from '@phosphor/clipboard-text.svg';
import { createForm, useFormsForDatabaseQuery } from '@queries/storage/forms';
import { Dropdown } from '@ui';
import { createSignal, For, Show } from 'solid-js';

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
    if (
      !props.canCreate ||
      creating() ||
      !forms.isSuccess ||
      onTable().length > 0
    )
      return;
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
        <Show
          when={props.canCreate && forms.isSuccess}
          fallback={
            <Dropdown.Item disabled>
              {forms.isError
                ? 'Could not load forms'
                : forms.isSuccess
                  ? 'No forms for this table'
                  : 'Loading forms…'}
            </Dropdown.Item>
          }
        >
          <Dropdown.Item
            disabled={creating()}
            closeOnSelect={false}
            onSelect={() => void createFromTable()}
          >
            <ClipboardText class="size-4 text-violet" aria-hidden="true" />
            {creating() ? 'Creating form…' : 'New form'}
          </Dropdown.Item>
        </Show>
      }
    >
      <Dropdown.Group>
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
      </Dropdown.Group>
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
