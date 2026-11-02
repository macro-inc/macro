import { fireAndForget } from '@core/util/fireAndForget';
import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import LinkIcon from '@icon/system/regular/link-simple.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Key } from '@solid-primitives/keyed';
import { Button, Dialog, Input } from '@ui';
import { type Component, createSignal, Match, Show, Switch } from 'solid-js';
import {
  GridCell,
  type GridCellProps,
} from '../../database/components/grid-cell';
import type { DatabaseViewColumn } from '../../database/core/database-view';
import { type DatabaseRow, rowValue } from '../../database/core/table';
import type { RowLinksSource } from '../context/row-links';
import type { LinkedRowGroup, RowReference } from '../core/row-links';

/** Read-only source fields use the same values and formatting as database records. */
export function LinkedRowPreview(
  props: Pick<GridCellProps, 'renderTextValue' | 'renderMentionValue'> & {
    columns: DatabaseViewColumn[];
    row: DatabaseRow;
  }
) {
  return (
    <div class="flex flex-col gap-1.5">
      <Key
        each={props.columns.slice(0, 4)}
        by="id"
        fallback={<span class="text-sm text-ink-muted">Unnamed</span>}
      >
        {(column, index) => (
          <div class="min-w-0">
            <Show when={index() > 0}>
              <span class="text-xs text-ink-muted">{column().name}</span>
            </Show>
            <GridCell
              column={column()}
              value={rowValue(props.row, column().id)}
              canEdit={false}
              wrap
              emptyLabel={index() === 0 ? 'Unnamed' : '—'}
              onWrite={async () => false}
              onAddOption={async () => false}
              renderTextValue={props.renderTextValue}
              renderMentionValue={props.renderMentionValue}
            />
          </div>
        )}
      </Key>
    </div>
  );
}

export type RowPickerProps = {
  returnFocus?: HTMLElement;
  linkedIds: string[];
  onLink(source: RowReference): Promise<void>;
  onClose(): void;
};

/**
 * One presentation for the company overview and the pipeline record panel.
 * Table, row and column keys preserve focus when refreshes replace their objects.
 */
export function LinkedRowsSection(props: {
  source: RowLinksSource;
  canEdit: boolean;
  Picker: Component<RowPickerProps>;
  Preview: Component<{ group: LinkedRowGroup; row: DatabaseRow }>;
  openRow(source: RowReference): void;
}) {
  let linkButton: HTMLButtonElement | undefined;
  const [picking, setPicking] = createSignal(false);
  const [pending, setPending] = createSignal<string>();
  const [error, setError] = createSignal('');
  const groups = () => {
    const state = props.source.state();
    return state.kind === 'ready' ? state.groups : [];
  };
  async function unlink(rowId: string) {
    if (pending()) return;
    setPending(rowId);
    setError('');
    try {
      await props.source.unlink(rowId);
    } catch {
      setError('Could not unlink this row. Try again.');
    } finally {
      setPending(undefined);
    }
  }
  return (
    <section aria-label="Linked rows" class="flex min-w-0 flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-medium">Linked rows</h3>
        <Show when={props.canEdit}>
          <Button
            ref={linkButton}
            size="sm"
            variant="secondary"
            onClick={() => setPicking(true)}
          >
            <LinkIcon class="pointer-events-none size-3.5 shrink-0 touch:size-6" />{' '}
            Link row
          </Button>
        </Show>
      </div>
      <Switch>
        <Match when={props.source.state().kind === 'loading'}>
          <p class="text-sm text-ink-muted">Loading linked rows…</p>
        </Match>
        <Match when={props.source.state().kind === 'error'}>
          <div
            role="alert"
            class="flex items-center gap-2 text-sm text-ink-muted"
          >
            Could not load linked rows.
            <Button
              size="sm"
              variant="ghost"
              onClick={() => fireAndForget(props.source.refresh(), 'crm')}
            >
              Retry
            </Button>
          </div>
        </Match>
        <Match when={props.source.state().kind === 'ready'}>
          <Key
            each={groups()}
            by="tableId"
            fallback={
              <p class="text-sm text-ink-muted">No linked rows available.</p>
            }
          >
            {(group) => (
              <div class="flex min-w-0 flex-col gap-2">
                <h4 class="truncate text-xs text-ink-muted">
                  {group().databaseName} / {group().tableName}
                </h4>
                <Key each={group().rows} by="rowId">
                  {(row) => (
                    <div class="min-w-0 rounded-lg border border-edge-muted p-3">
                      <div class="flex items-start gap-2">
                        <div class="min-w-0 flex-1">
                          <props.Preview group={group()} row={row()} />
                        </div>
                        <div class="flex shrink-0 items-center gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Open source row"
                            tooltip="Open source row"
                            onClick={() =>
                              props.openRow({
                                databaseId: group().databaseId,
                                tableId: group().tableId,
                                rowId: row().rowId,
                              })
                            }
                          >
                            <ArrowUpRightIcon class="pointer-events-none size-3.5 shrink-0 touch:size-6" />
                          </Button>
                          <Show when={props.canEdit}>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Unlink row"
                              tooltip="Unlink row"
                              disabled={!!pending()}
                              onClick={() =>
                                fireAndForget(unlink(row().rowId), 'crm')
                              }
                            >
                              <XIcon class="pointer-events-none size-3.5 shrink-0 touch:size-6" />
                            </Button>
                          </Show>
                        </div>
                      </div>
                    </div>
                  )}
                </Key>
              </div>
            )}
          </Key>
        </Match>
      </Switch>
      <Show when={error()}>
        <p role="alert" class="text-sm text-failure-ink">
          {error()}
        </p>
      </Show>
      <Show when={picking()}>
        <props.Picker
          returnFocus={linkButton}
          linkedIds={groups().flatMap((group) =>
            group.rows.map((row) => row.rowId)
          )}
          onLink={props.source.link}
          onClose={() => setPicking(false)}
        />
      </Show>
    </section>
  );
}

export type RowPickerTable = {
  databaseId: string;
  tableId: string;
  name: string;
};

/** Pick a table first, then an existing row; no source data is mutated here. */
export function LinkedRowPicker(
  props: RowPickerProps & {
    tables: RowPickerTable[];
    selected?: RowPickerTable;
    onSelectTable(table: RowPickerTable | undefined): void;
    rows: { id: string; name: string }[];
    loading: boolean;
    error?: string;
    retry(): Promise<void>;
  }
) {
  const [search, setSearch] = createSignal('');
  const [pending, setPending] = createSignal<string>();
  const [error, setError] = createSignal('');
  const matches = (name: string) =>
    name.toLocaleLowerCase().includes(search().trim().toLocaleLowerCase());
  async function link(rowId: string) {
    const table = props.selected;
    if (!table || pending()) return;
    setPending(rowId);
    setError('');
    try {
      await props.onLink({
        databaseId: table.databaseId,
        tableId: table.tableId,
        rowId,
      });
    } catch {
      setError('Could not link this row. Check your access and try again.');
    } finally {
      setPending(undefined);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !pending() && props.onClose()}
      onCloseAutoFocus={(event) => {
        if (props.returnFocus?.isConnected) {
          event.preventDefault();
          props.returnFocus.focus();
        }
      }}
      class="flex max-h-[80dvh] w-112 max-w-[calc(100vw-2rem)] flex-col gap-4 p-5"
    >
      <Dialog.Title class="text-base font-medium">
        Link database row
      </Dialog.Title>
      <Dialog.Description class="text-sm text-ink-muted">
        Choose a row you can access. Linking keeps its existing permissions.
      </Dialog.Description>
      <Show when={props.selected}>
        {(selected) => (
          <div class="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={!!pending()}
              onClick={() => {
                props.onSelectTable(undefined);
                setSearch('');
              }}
            >
              Back
            </Button>
            <span class="truncate text-sm">{selected().name}</span>
          </div>
        )}
      </Show>
      <Input
        aria-label={props.selected ? 'Find a row' : 'Find a database or table'}
        placeholder={
          props.selected ? 'Find a row…' : 'Find a database or table…'
        }
        value={search()}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
      <div class="min-h-0 overflow-auto">
        <Show
          when={!props.loading}
          fallback={<p class="text-sm text-ink-muted">Loading…</p>}
        >
          <Show
            when={!props.error}
            fallback={
              <div role="alert" class="flex items-center gap-2 text-sm">
                {props.error}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => fireAndForget(props.retry(), 'crm')}
                >
                  Retry
                </Button>
              </div>
            }
          >
            <Show
              when={props.selected}
              fallback={
                <Key
                  each={props.tables.filter((table) => matches(table.name))}
                  by="tableId"
                  fallback={
                    <p class="text-sm text-ink-muted">No matching tables.</p>
                  }
                >
                  {(table) => (
                    <Button
                      variant="ghost"
                      class="w-full justify-start"
                      onClick={() => {
                        props.onSelectTable(table());
                        setSearch('');
                      }}
                    >
                      {table().name}
                    </Button>
                  )}
                </Key>
              }
            >
              <Key
                each={props.rows.filter((row) => matches(row.name))}
                by="id"
                fallback={
                  <p class="text-sm text-ink-muted">No matching rows.</p>
                }
              >
                {(row) => (
                  <Button
                    variant="ghost"
                    class="w-full justify-start"
                    disabled={!!pending() || props.linkedIds.includes(row().id)}
                    onClick={() => fireAndForget(link(row().id), 'crm')}
                  >
                    <span class="min-w-0 flex-1 truncate">{row().name}</span>
                    <Show when={props.linkedIds.includes(row().id)}>
                      Linked
                    </Show>
                  </Button>
                )}
              </Key>
            </Show>
          </Show>
        </Show>
      </div>
      <Show when={error()}>
        <p role="alert" class="text-sm text-failure-ink">
          {error()}
        </p>
      </Show>
      <Button
        variant="secondary"
        disabled={!!pending()}
        onClick={props.onClose}
      >
        Done
      </Button>
    </Dialog>
  );
}
