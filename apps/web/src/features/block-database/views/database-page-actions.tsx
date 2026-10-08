import { downloadFile } from '@filesystem/download';
import CaretRightIcon from '@phosphor/caret-right.svg';
import DotsThreeIcon from '@phosphor/dots-three.svg';
import DownloadIcon from '@phosphor/download-simple.svg';
import PencilIcon from '@phosphor/pencil-line.svg';
import TrashIcon from '@phosphor/trash-simple.svg';
import UploadIcon from '@phosphor/upload-simple.svg';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { ImportTable } from '@service-storage/generated/schemas/importTable';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { DeleteDialog } from '@ui/components/DeleteDialog';
import { Dropdown } from '@ui/components/Dropdown';
import { errAsync, ResultAsync } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { toast } from '../../../lib/core/component/Toast/Toast';
import { CsvImportDialog } from '../../database/components/csv-import-dialog';
import {
  type DatabaseCsv,
  type DatabaseCsvFailure,
  databaseCsvMessage,
  MAX_CSV_BYTES,
  parseDatabaseCsv,
} from '../../database/core/csv';
import { isDatabaseNameTaken } from '../../database/core/property-creation';
import {
  type DatabaseEntityFailure,
  databaseEntityMessage,
} from '../../database/core/write-failure';
import {
  exportDatabaseTableCsv,
  importDatabaseTable,
} from '../queries/transfer';

/** A CSV that cannot become a table, or a file that could not be read at all. */
type CsvImportFailure = DatabaseCsvFailure | { kind: 'unreadable' };

export function DatabasePageActions(props: {
  detail: DatabaseDetail;
  table?: TableDetail;
  onImported: (tableId: string) => void;
  onRename: () => void;
  onDelete: () => ResultAsync<void, DatabaseEntityFailure>;
}) {
  const [exporting, setExporting] = createSignal(false);
  const [reading, setReading] = createSignal(false);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal('');
  const [draft, setDraft] = createSignal<{ data: DatabaseCsv; name: string }>();
  let fileInput: HTMLInputElement | undefined;
  let menuButton: HTMLButtonElement | undefined;
  let focusTitleAfterClose = false;
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
      (blob) => downloadFile(blob, `${table.table.name}.csv`),
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
        props.onImported(table.id);
        toast.success('CSV imported');
      }
    );
  }
  async function removeDatabase() {
    if (deleting() || props.detail.grant !== 'owner') return;
    setDeleting(true);
    setDeleteError('');
    const deleted = await props.onDelete();
    setDeleting(false);
    deleted.match(
      () => setConfirmDelete(false),
      (failure) => setDeleteError(databaseEntityMessage(failure, 'delete'))
    );
  }
  return (
    <>
      <Show when={editable()}>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          class="hidden"
          aria-label="Choose CSV file"
          onChange={(event) => void selectFile(event.currentTarget.files?.[0])}
        />
      </Show>
      <Dropdown>
        <Dropdown.Trigger
          ref={menuButton}
          variant="ghost"
          size="icon-sm"
          label="Database actions"
        >
          <DotsThreeIcon class="size-5" />
        </Dropdown.Trigger>
        <Dropdown.Content
          class="w-56"
          onCloseAutoFocus={(event) => {
            if (focusTitleAfterClose) {
              event.preventDefault();
              focusTitleAfterClose = false;
              queueMicrotask(props.onRename);
            } else if (confirmDelete()) event.preventDefault();
          }}
        >
          <Show when={editable()}>
            <Dropdown.Group>
              <Dropdown.Item onSelect={() => (focusTitleAfterClose = true)}>
                <PencilIcon class="size-4 shrink-0" />
                Rename
              </Dropdown.Item>
            </Dropdown.Group>
          </Show>
          <Dropdown.Group>
            <Show when={editable()}>
              <Dropdown.Item
                disabled={reading()}
                onSelect={() => fileInput?.click()}
              >
                <UploadIcon class="size-4 shrink-0" />
                Import CSV
              </Dropdown.Item>
            </Show>
            <Dropdown.Sub>
              <Dropdown.SubTrigger disabled={exporting()}>
                <DownloadIcon class="size-4 shrink-0" />
                <span class="flex-1">Download</span>
                <CaretRightIcon class="size-3.5 shrink-0" />
              </Dropdown.SubTrigger>
              <Dropdown.SubContent class="w-56">
                <Dropdown.Item
                  disabled={!props.table || exporting()}
                  onSelect={() => void exportCsv()}
                >
                  Current table as CSV
                </Dropdown.Item>
              </Dropdown.SubContent>
            </Dropdown.Sub>
          </Dropdown.Group>
          <Show when={props.detail.grant === 'owner'}>
            <Dropdown.Group>
              <Dropdown.Item
                class="text-failure-ink"
                onSelect={() => {
                  setDeleteError('');
                  setConfirmDelete(true);
                }}
              >
                <TrashIcon class="size-4 shrink-0" />
                Delete
              </Dropdown.Item>
            </Dropdown.Group>
          </Show>
        </Dropdown.Content>
      </Dropdown>
      <Show when={draft()}>
        {(value) => (
          <CsvImportDialog
            data={value().data}
            initialName={value().name}
            onImport={importFile}
            onClose={() => setDraft(undefined)}
            returnFocus={menuButton}
          />
        )}
      </Show>
      <DeleteDialog
        open={confirmDelete()}
        onOpenChange={setConfirmDelete}
        title="Delete database?"
        pending={deleting()}
        onDelete={() => void removeDatabase()}
        body={
          <>
            <p>
              “{props.detail.database.name}” and its tables and views will be
              moved to Trash.
            </p>
            <Show when={deleteError()}>
              <p role="alert" class="mt-2 text-failure-ink">
                {deleteError()}
              </p>
            </Show>
          </>
        }
      />
    </>
  );
}
