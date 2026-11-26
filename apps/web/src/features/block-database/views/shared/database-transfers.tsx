import { fireAndForget } from '@core/util/fireAndForget';
import { downloadFile } from '@filesystem/download';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { ImportTable } from '@service-storage/generated/schemas/importTable';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { errAsync, ResultAsync } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { toast } from '../../../../lib/core/component/Toast/Toast';
import { CsvImportDialog } from '../../../database/components/csv-import-dialog';
import {
  type DatabaseCsv,
  type DatabaseCsvFailure,
  databaseCsvMessage,
  MAX_CSV_BYTES,
  parseDatabaseCsv,
} from '../../../database/core/csv';
import { isDatabaseNameTaken } from '../../../database/core/property-creation';
import { SyncDialog } from '../../component/SyncDialog';
import { WebhooksDialog } from '../../component/WebhooksDialog';
import {
  exportDatabaseTableCsv,
  importDatabaseTable,
} from '../../queries/transfer';

/** A CSV that cannot become a table, or a file that could not be read at all. */
type CsvImportFailure = DatabaseCsvFailure | { kind: 'unreadable' };

/** The items every entity's "…" menu offers, supplied by the host. */
export type DatabaseEntityActions = {
  favorited: boolean;
  onToggleFavorite: () => void;
  onCopyLink: () => void | boolean | Promise<void | boolean>;
  onCopyId: () => void | boolean | Promise<void | boolean>;
  /** Whether a copy is being made; Duplicate waits for it. */
  duplicating: boolean;
  /** Copy the database into a new one the viewer owns, and open it. */
  onDuplicate: () => void;
  /** Present for the owner, who alone may file it in a folder. */
  onMoveToFolder?: () => void;
};

/**
 * A database's CSV import and export, its webhooks and its synced tables: the
 * state behind those menu items, whichever menu draws them, and the dialogs
 * they open.
 */
export function createDatabaseTransfers(props: {
  detail: DatabaseDetail;
  table?: TableDetail;
  /** Show a table the menu just added (an imported CSV or a synced table). */
  onTableAdded: (tableId: string) => void;
}) {
  const [exporting, setExporting] = createSignal(false);
  const [reading, setReading] = createSignal(false);
  const [draft, setDraft] = createSignal<{ data: DatabaseCsv; name: string }>();
  const [webhooksOpen, setWebhooksOpen] = createSignal(false);
  const [syncOpen, setSyncOpen] = createSignal(false);
  let fileInput: HTMLInputElement | undefined;
  const editable = () =>
    props.detail.grant === 'edit' || props.detail.grant === 'owner';
  async function selectFile(file: File | undefined) {
    if (!file || reading()) return;
    setReading(true);
    const read =
      file.size > MAX_CSV_BYTES
        ? errAsync<string, CsvImportFailure>({ kind: 'too-large' })
        : ResultAsync.fromPromise(
            file.text(),
            (): CsvImportFailure => ({ kind: 'unreadable' })
          );
    const parsed = await read.andThen(parseDatabaseCsv);
    setReading(false);
    if (fileInput) fileInput.value = '';
    parsed.match(
      (data) => setDraft({ data, name: importedTableName(file.name) }),
      (failure) =>
        toast.failure(
          failure.kind === 'unreadable'
            ? 'Could not read this file.'
            : databaseCsvMessage(failure)
        )
    );
  }
  function importedTableName(fileName: string) {
    const base =
      fileName
        .replace(/\.csv$/i, '')
        .trim()
        .slice(0, 190) || 'Imported table';
    const names = props.detail.tables.map((table) => table.table.name);
    let name = base;
    let suffix = 2;
    while (isDatabaseNameTaken(name, names)) name = `${base} ${suffix++}`;
    return name;
  }
  async function exportCsv() {
    const table = props.table;
    if (exporting() || !table) return;
    setExporting(true);
    const exported = await exportDatabaseTableCsv(props.detail, table);
    setExporting(false);
    exported.match(
      (blob) =>
        fireAndForget(
          downloadFile(blob, `${table.table.name}.csv`),
          'database-page-actions'
        ),
      (failure) =>
        toast.failure(
          failure.kind === 'too-large'
            ? 'This table is too large for CSV export.'
            : 'Could not export this table.'
        )
    );
  }
  function importFile(request: ImportTable) {
    return importDatabaseTable(props.detail.database.id, request).map(
      (table) => {
        props.onTableAdded(table.id);
        toast.success('CSV imported');
      }
    );
  }

  return {
    editable,
    reading,
    exporting,
    chooseCsv: () => fileInput?.click(),
    exportCsv: () => fireAndForget(exportCsv(), 'database-page-actions'),
    openWebhooks: () => {
      setWebhooksOpen(true);
    },
    openSync: () => {
      setSyncOpen(true);
    },
    /** The hidden input behind Import CSV. */
    fileInput: () => (
      <Show when={editable()}>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          class="hidden"
          aria-label="Choose CSV file"
          onChange={(event) =>
            fireAndForget(
              selectFile(event.currentTarget.files?.[0]),
              'database-page-actions'
            )
          }
        />
      </Show>
    ),
    /** The import, webhooks and sync dialogs; focus returns to `returnFocus`. */
    dialogs: (returnFocus: () => HTMLElement | undefined) => (
      <>
        <Show when={draft()}>
          {(value) => (
            <CsvImportDialog
              data={value().data}
              initialName={value().name}
              onImport={importFile}
              onClose={() => setDraft(undefined)}
              returnFocus={returnFocus()}
            />
          )}
        </Show>
        <Show when={webhooksOpen() && props.table}>
          {(table) => (
            <Show
              keyed
              when={`${props.detail.database.id}:${table().table.id}`}
            >
              <WebhooksDialog
                databaseId={props.detail.database.id}
                table={table()}
                onClose={() => setWebhooksOpen(false)}
                returnFocus={returnFocus()}
              />
            </Show>
          )}
        </Show>
        <Show when={syncOpen()}>
          <SyncDialog
            detail={props.detail}
            onTableAdded={props.onTableAdded}
            onClose={() => setSyncOpen(false)}
            returnFocus={returnFocus()}
          />
        </Show>
      </>
    ),
  };
}
