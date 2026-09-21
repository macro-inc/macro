import { idToEmail } from '@core/user/util';
import { type CrmCompanyEntity, getCompanyOwnerId } from '@entity';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { useListPropertiesQuery } from '@queries/properties/definitions';
import { Button, Dialog, Panel } from '@ui';
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import {
  COMPANY_EXPORT_COLUMNS,
  companyExportRecord,
  createCrmCsv,
  type ExportColumn,
  type ExportRecord,
  PEOPLE_EXPORT_COLUMNS,
  personExportRecord,
} from '../core/crm-export';
import type { CrmPerson } from '../core/crm-people';
import { useDealStages } from '../crm/deal-stages';

export function CrmExport(props: {
  kind: 'companies' | 'people';
  currentView: string;
  onClose: () => void;
  onLoad: (
    scope: 'current' | 'all',
    signal: AbortSignal,
    progress: (count: number) => void
  ) => Promise<{ companies?: CrmCompanyEntity[]; people?: CrmPerson[] }>;
}) {
  const stages = useDealStages();
  const definitions = useListPropertiesQuery(
    () => ({
      scope: 'all',
      includeOptions: true,
      forEntityType: 'COMPANY',
    }),
    () => props.kind === 'companies'
  );
  const baseColumns =
    props.kind === 'people' ? PEOPLE_EXPORT_COLUMNS : COMPANY_EXPORT_COLUMNS;
  const [scope, setScope] = createSignal<'current' | 'all'>('current');
  const [selected, setSelected] = createSignal(
    baseColumns.filter((column) => column.default).map((column) => column.id)
  );
  const [rows, setRows] = createSignal<ExportRecord[]>();
  const [pending, setPending] = createSignal(false);
  const [progress, setProgress] = createSignal(0);
  const [error, setError] = createSignal('');
  let controller: AbortController | undefined;
  onCleanup(() => controller?.abort());
  const propertyDefinitions = () =>
    props.kind === 'companies' && definitions.isSuccess ? definitions.data : [];
  const columns = createMemo<ExportColumn[]>(() => [
    ...baseColumns,
    ...propertyDefinitions().flatMap((entry) => {
      const definition = 'definition' in entry ? entry.definition : entry;
      if (
        definition.is_metadata ||
        baseColumns.some(
          (column) => column.id === `property:${definition.id}`
        ) ||
        [
          SYSTEM_PROPERTY_IDS.STAGE,
          SYSTEM_PROPERTY_IDS.COMPANY_OWNER,
          stages.stageDefinitionId(),
        ].includes(definition.id)
      )
        return [];
      return [
        { id: `property:${definition.id}`, label: definition.display_name },
      ];
    }),
  ]);
  const selectedColumns = () =>
    columns().filter((column) => selected().includes(column.id));
  const options = createMemo(
    () =>
      new Map(
        propertyDefinitions().flatMap((entry) =>
          'property_options' in entry
            ? entry.property_options.map(
                (option) => [option.id, String(option.value.value)] as const
              )
            : []
        )
      )
  );
  const formatProperty = (
    property: NonNullable<CrmCompanyEntity['properties']>[number]
  ) => {
    const value = property.value;
    if (!value) return '';
    if (value.type === 'SelectOption')
      return value.value.map((id) => options().get(id) ?? id).join('; ');
    if (value.type === 'EntityReference')
      return value.value
        .map((ref) =>
          ref.entity_id.startsWith('macro|')
            ? idToEmail(ref.entity_id)
            : ref.entity_id
        )
        .join('; ');
    return Array.isArray(value.value) ? value.value.join('; ') : value.value;
  };
  const metadataLoading = () =>
    props.kind === 'companies' && (definitions.isPending || stages.isLoading());
  const metadataError = () =>
    props.kind === 'companies' && (definitions.isError || stages.isError());
  const filename = () =>
    `macro-${
      scope() === 'all'
        ? `all-${props.kind}`
        : props.currentView
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || props.kind
    }-${new Date().toISOString().slice(0, 10)}.csv`;
  async function prepare() {
    if (pending()) return;
    controller = new AbortController();
    const signal = controller.signal;
    setPending(true);
    setError('');
    setProgress(0);
    setRows(undefined);
    try {
      const result = await props.onLoad(scope(), signal, setProgress);
      signal.throwIfAborted();
      setRows(
        result.people
          ? result.people.map(personExportRecord)
          : (result.companies ?? []).map((company) => {
              const stageId = stages.resolveStage(company);
              const owner = getCompanyOwnerId(company);
              return companyExportRecord(
                company,
                stageId ? (stages.stageLabel(stageId) ?? stageId) : '',
                owner ? idToEmail(owner) : '',
                formatProperty
              );
            })
      );
    } catch (cause) {
      if (!signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not prepare the export. Please retry.'
        );
    } finally {
      if (!signal.aborted) setPending(false);
    }
  }
  function download() {
    const data = rows();
    if (!data || !selectedColumns().length) return;
    const blob = new Blob([createCrmCsv(selectedColumns(), data)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename();
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    props.onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      class="w-[560px] max-w-[calc(100vw-2rem)]"
    >
      <Panel>
        <Panel.Body>
          <div class="flex max-h-[85vh] flex-col">
            <div class="px-5 pt-5 pb-4">
              <Dialog.Title class="text-base font-semibold">
                Export {props.kind}
              </Dialog.Title>
              <Dialog.Description class="mt-1 text-sm text-ink-muted">
                Choose the records and columns for your CSV. Review the export
                before downloading.
              </Dialog.Description>
            </div>
            <div class="min-h-0 overflow-auto px-5 pb-4 flex flex-col gap-5">
              <fieldset disabled={pending()} class="flex flex-col gap-2">
                <legend class="mb-2 text-xs font-medium text-ink-muted">
                  Records
                </legend>
                <For each={['current', 'all'] as const}>
                  {(value) => (
                    <label class="flex items-start gap-3 rounded-lg bg-hover/50 p-3 text-sm">
                      <input
                        type="radio"
                        name="crm-export-scope"
                        value={value}
                        checked={scope() === value}
                        onChange={() => {
                          setScope(value);
                          setRows(undefined);
                          setError('');
                        }}
                        class="mt-0.5 accent-accent"
                      />
                      <span>
                        <span class="block font-medium">
                          {value === 'current'
                            ? `Current view · ${props.currentView}`
                            : `All ${props.kind} across views`}
                        </span>
                        <span class="mt-1 block text-xs text-ink-muted">
                          {value === 'current'
                            ? 'Includes all matching records, with the current filters and search.'
                            : 'All visible records, once each. Ignores the current filters and search.'}
                        </span>
                      </span>
                    </label>
                  )}
                </For>
              </fieldset>
              <fieldset disabled={pending()} aria-label="Export columns">
                <div class="mb-2 flex items-center justify-between gap-3">
                  <span class="text-xs font-medium text-ink-muted">
                    Columns · {selectedColumns().length} selected
                  </span>
                  <div class="flex gap-2 text-xs">
                    <button
                      type="button"
                      class="text-ink-muted hover:text-ink"
                      onClick={() =>
                        setSelected(columns().map((column) => column.id))
                      }
                    >
                      Select all
                    </button>
                    <span class="text-ink-extra-muted">/</span>
                    <button
                      type="button"
                      class="text-ink-muted hover:text-ink"
                      onClick={() => setSelected([])}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-x-3 gap-y-1">
                  <For each={baseColumns}>
                    {(column) => (
                      <label class="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-hover">
                        <input
                          type="checkbox"
                          class="accent-accent"
                          checked={selected().includes(column.id)}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.currentTarget.checked
                                ? [...current, column.id]
                                : current.filter((id) => id !== column.id)
                            )
                          }
                        />
                        <span class="truncate" title={column.label}>
                          {column.label}
                        </span>
                      </label>
                    )}
                  </For>
                </div>
                <Show when={columns().length > baseColumns.length}>
                  <details class="mt-3 rounded-lg bg-hover/40 px-3 py-2">
                    <summary class="text-xs font-medium text-ink-muted">
                      Additional properties ·{' '}
                      {columns().length - baseColumns.length}
                    </summary>
                    <div class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                      <For each={columns().slice(baseColumns.length)}>
                        {(column) => (
                          <label class="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-hover">
                            <input
                              type="checkbox"
                              class="accent-accent"
                              checked={selected().includes(column.id)}
                              onChange={(event) =>
                                setSelected((current) =>
                                  event.currentTarget.checked
                                    ? [...current, column.id]
                                    : current.filter((id) => id !== column.id)
                                )
                              }
                            />
                            <span class="truncate" title={column.label}>
                              {column.label}
                            </span>
                          </label>
                        )}
                      </For>
                    </div>
                  </details>
                </Show>
                <Show when={metadataLoading()}>
                  <p class="mt-2 text-xs text-ink-muted">
                    Loading property columns…
                  </p>
                </Show>
                <Show when={metadataError()}>
                  <p role="alert" class="mt-2 text-sm text-failure">
                    Could not load CRM properties. Close and reopen Export to
                    retry.
                  </p>
                </Show>
              </fieldset>
              <Show when={rows()}>
                {(data) => (
                  <div class="flex flex-col gap-2">
                    <p role="status" class="text-sm font-medium">
                      {data().length.toLocaleString()} {props.kind} ·{' '}
                      {selectedColumns().length} columns
                    </p>
                    <Show
                      when={data().length}
                      fallback={
                        <p class="text-xs text-ink-muted">
                          No records match. The CSV will contain column headers
                          only.
                        </p>
                      }
                    >
                      <div class="overflow-x-auto rounded-lg bg-hover/40 p-2">
                        <table
                          class="w-full text-left text-xs"
                          aria-label="Export preview"
                        >
                          <thead>
                            <tr>
                              <For each={selectedColumns()}>
                                {(column) => (
                                  <th class="whitespace-nowrap px-2 py-2 font-medium text-ink-muted">
                                    {column.label}
                                  </th>
                                )}
                              </For>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={data().slice(0, 3)}>
                              {(record) => (
                                <tr>
                                  <For each={selectedColumns()}>
                                    {(column) => (
                                      <td
                                        class="max-w-40 truncate px-2 py-1.5"
                                        title={String(record[column.id] ?? '')}
                                      >
                                        {String(record[column.id] ?? '')}
                                      </td>
                                    )}
                                  </For>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      </div>
                      <p class="text-xs text-ink-muted">
                        Preview of the first {Math.min(3, data().length)}{' '}
                        records. Dates retain their original timestamps.
                      </p>
                    </Show>
                  </div>
                )}
              </Show>
              <Show when={pending()}>
                <p role="status" class="text-sm text-ink-muted">
                  Preparing all records…{' '}
                  {progress() ? `${progress().toLocaleString()} loaded` : ''}
                </p>
              </Show>
              <Show when={error()}>
                <p role="alert" class="text-sm text-failure">
                  {error()}
                </p>
              </Show>
            </div>
            <div class="flex items-center gap-3 border-t border-edge-muted px-5 py-4">
              <span
                class="mr-auto min-w-0 truncate text-xs text-ink-muted"
                title={filename()}
              >
                {filename()}
              </span>
              <Button variant="ghost" onClick={props.onClose}>
                Cancel
              </Button>
              <Button
                variant="accent"
                disabled={
                  pending() ||
                  !selectedColumns().length ||
                  metadataLoading() ||
                  metadataError()
                }
                onClick={() => (rows() ? download() : void prepare())}
              >
                {pending()
                  ? 'Preparing…'
                  : rows()
                    ? 'Download CSV'
                    : 'Prepare export'}
              </Button>
            </div>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
