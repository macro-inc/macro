import { LiveIndicators } from '@core/component/LiveIndicators';
import { getPermissions } from '@core/component/SharePermissions';
import { toast } from '@core/component/Toast/Toast';
import {
  ShareDialogContext,
  ShareModal,
  ShareTrigger,
} from '@core/component/TopBar/ShareButton';
import { useUserId } from '@core/context/user';
import { useUserIndicators } from '@core/state/liveIndicators';
import { downloadFile } from '@filesystem/download';
import DownloadIcon from '@phosphor/download-simple.svg';
import UploadIcon from '@phosphor/upload-simple.svg';
import { downloadDatabaseSnapshot } from '@queries/storage/databases';
import type {
  DatabaseDetail,
  DatabaseTableDetail,
  ImportDatabaseTableRequest,
} from '@service-storage/databases';
import { Button } from '@ui/components/Button';
import { Dropdown } from '@ui/components/Dropdown';
import { createSignal, Show } from 'solid-js';
import { CsvImportDialog } from '../components/csv-import-dialog';
import { type DatabaseCsv, MAX_CSV_BYTES, parseDatabaseCsv } from '../core/csv';
import {
  exportDatabaseTableCsv,
  importDatabaseTable,
} from '../queries/transfer';

export function DatabasePageActions(props: {
  detail: DatabaseDetail;
  table?: DatabaseTableDetail;
  onImported: (tableId: string) => void;
}) {
  const userId = useUserId();
  const viewers = useUserIndicators(() => props.detail.database.id);
  const [sharing, setSharing] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);
  const [reading, setReading] = createSignal(false);
  const [draft, setDraft] = createSignal<{ data: DatabaseCsv; name: string }>();
  let fileInput: HTMLInputElement | undefined;
  let importButton: HTMLButtonElement | undefined;
  const editable = () =>
    props.detail.grant === 'edit' || props.detail.grant === 'owner';
  async function selectFile(file: File | undefined) {
    if (!file || reading()) return;
    setReading(true);
    try {
      if (file.size > MAX_CSV_BYTES)
        throw new Error('Choose a CSV smaller than 8 MB.');
      const data = parseDatabaseCsv(await file.text());
      const base =
        file.name
          .replace(/\.csv$/i, '')
          .trim()
          .slice(0, 190) || 'Imported table';
      let name = base;
      let suffix = 2;
      while (
        props.detail.tables.some(
          (table) => table.table.name.toLowerCase() === name.toLowerCase()
        )
      )
        name = `${base} ${suffix++}`;
      setDraft({ data, name });
    } catch (error) {
      toast.failure(
        error instanceof Error ? error.message : 'Could not read this CSV.'
      );
    } finally {
      setReading(false);
      if (fileInput) fileInput.value = '';
    }
  }
  async function exportFile(format: 'csv' | 'sqlite') {
    if (exporting()) return;
    setExporting(true);
    const table = props.table;
    try {
      if (format === 'csv') {
        if (!table) return;
        downloadFile(
          await exportDatabaseTableCsv(table),
          `${table.table.name}.csv`
        );
      } else
        downloadFile(
          await downloadDatabaseSnapshot(props.detail.database.id),
          `${props.detail.database.name}.sqlite`
        );
    } catch (error) {
      toast.failure(
        error instanceof Error
          ? error.message
          : 'Could not export the database.'
      );
    } finally {
      setExporting(false);
    }
  }
  async function importFile(request: ImportDatabaseTableRequest) {
    const table = await importDatabaseTable(props.detail.database.id, request);
    props.onImported(table.id);
    toast.success('CSV imported');
  }
  return (
    <>
      <LiveIndicators userIds={viewers() ?? []} currentUserId={userId()} />
      <Show when={editable()}>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          class="hidden"
          aria-label="Choose CSV file"
          onChange={(event) => void selectFile(event.currentTarget.files?.[0])}
        />
        <Button
          ref={importButton}
          variant="ghost"
          size="icon-md"
          label="Import CSV"
          disabled={reading()}
          onClick={() => fileInput?.click()}
        >
          <UploadIcon class="size-4" />
        </Button>
      </Show>
      <Dropdown>
        <Dropdown.Trigger
          variant="ghost"
          size="icon-md"
          aria-label="Download database"
          disabled={exporting()}
        >
          <DownloadIcon class="size-4" />
        </Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Item
            disabled={!props.table}
            onSelect={() => void exportFile('csv')}
          >
            Current table as CSV
          </Dropdown.Item>
          <Dropdown.Item onSelect={() => void exportFile('sqlite')}>
            Database as SQLite
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown>
      <ShareDialogContext.Provider
        value={{
          isOpen: sharing,
          open: () => setSharing(true),
          close: () => setSharing(false),
        }}
      >
        <ShareTrigger id={props.detail.database.id} blockType="database" />
        <ShareModal
          id={props.detail.database.id}
          itemType="database"
          blockAlias="database"
          owner={props.detail.database.owner_id}
          name={props.detail.database.name}
          userPermissions={getPermissions(props.detail.grant)}
          isSharePermOpen={sharing()}
          setIsSharePermOpen={setSharing}
        />
      </ShareDialogContext.Provider>
      <Show when={draft()}>
        {(value) => (
          <CsvImportDialog
            data={value().data}
            initialName={value().name}
            onImport={importFile}
            onClose={() => setDraft(undefined)}
            returnFocus={importButton}
          />
        )}
      </Show>
    </>
  );
}
