import { readEntityAppearance } from '@app/features/entity-appearance/core/appearance';
import { useChangeEntityIcon } from '@app/features/entity-appearance/entity-appearance';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { enableEntityAppearance } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import { downloadFile } from '@filesystem/download';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import ArrowsClockwiseIcon from '@icon/system/regular/arrows-clockwise.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import DuplicateIcon from '@icon/system/regular/copy-simple.svg';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import DownloadIcon from '@icon/system/regular/download-simple.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import PencilIcon from '@icon/system/regular/pencil-line.svg';
import StarIcon from '@icon/system/regular/star.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import UploadIcon from '@icon/system/regular/upload-simple.svg';
import WebhookIcon from '@phosphor/webhooks-logo.svg';
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
import { SyncDialog } from '../component/SyncDialog';
import { WebhooksDialog } from '../component/WebhooksDialog';
import {
  exportDatabaseTableCsv,
  importDatabaseTable,
} from '../queries/transfer';

/** A CSV that cannot become a table, or a file that could not be read at all. */
type CsvImportFailure = DatabaseCsvFailure | { kind: 'unreadable' };

/** The items every entity's "…" menu offers, supplied by the host. */
export type DatabaseEntityActions = {
  favorited: boolean;
  onToggleFavorite: () => void;
  onCopyLink: () => void;
  onCopyId: () => void;
  /** Whether a copy is being made; Duplicate waits for it. */
  duplicating: boolean;
  /** Copy the database into a new one the viewer owns, and open it. */
  onDuplicate: () => void;
  /** Present for the owner, who alone may file it in a folder. */
  onMoveToFolder?: () => void;
};

export function DatabasePageActions(props: {
  detail: DatabaseDetail;
  table?: TableDetail;
  entityActions?: DatabaseEntityActions;
  /** Show a table the menu just added (an imported CSV or a synced table). */
  onTableAdded: (tableId: string) => void;
  onRename: () => void;
  onDelete: () => ResultAsync<void, DatabaseEntityFailure>;
}) {
  const [exporting, setExporting] = createSignal(false);
  const [reading, setReading] = createSignal(false);
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const changeIcon = useChangeEntityIcon();
  const appearanceFlag = useFeatureFlag(enableEntityAppearance);
  const [deleting, setDeleting] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal('');
  const [draft, setDraft] = createSignal<{ data: DatabaseCsv; name: string }>();
  const [webhooksOpen, setWebhooksOpen] = createSignal(false);
  const [syncOpen, setSyncOpen] = createSignal(false);
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
          onChange={(event) =>
            fireAndForget(
              selectFile(event.currentTarget.files?.[0]),
              'database-page-actions'
            )
          }
        />
      </Show>
      <Dropdown>
        <Dropdown.Trigger
          aria-label="Database actions"
          tooltip="Database actions"
          ref={menuButton}
          variant="ghost"
          size="icon-sm"
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
          <Show when={props.entityActions}>
            {(actions) => (
              <>
                <Dropdown.Group>
                  <Show when={editable() && appearanceFlag().enabled}>
                    <Dropdown.Item
                      onSelect={() =>
                        changeIcon(
                          {
                            type: 'database',
                            id: props.detail.database.id,
                            name: props.detail.database.name,
                            ownerId: props.detail.database.owner_id,
                            grant: props.detail.grant,
                            appearance: readEntityAppearance(
                              props.detail.database.appearance
                            ),
                            projectId:
                              props.detail.database.project_id ?? undefined,
                          },
                          menuButton
                        )
                      }
                    >
                      {t('appearance.title')}
                    </Dropdown.Item>
                  </Show>
                  <Dropdown.Item onSelect={actions().onCopyLink}>
                    <LinkIcon class="size-4 shrink-0" />
                    Copy Link
                  </Dropdown.Item>
                  <Dropdown.Item onSelect={actions().onCopyId}>
                    <CopyIcon class="size-4 shrink-0" />
                    Copy ID
                  </Dropdown.Item>
                </Dropdown.Group>
                <Dropdown.Group>
                  <Dropdown.Item onSelect={actions().onToggleFavorite}>
                    <StarIcon class="size-4 shrink-0" />
                    {actions().favorited ? 'Unfavorite' : 'Favorite'}
                  </Dropdown.Item>
                  <Show when={actions().onMoveToFolder}>
                    {(moveToFolder) => (
                      <Dropdown.Item onSelect={moveToFolder()}>
                        <ArrowRightIcon class="size-4 shrink-0" />
                        {t('entityActions.moveToFolder')}
                      </Dropdown.Item>
                    )}
                  </Show>
                </Dropdown.Group>
              </>
            )}
          </Show>
          <Show when={editable() || props.entityActions}>
            <Dropdown.Group>
              <Show when={editable()}>
                <Dropdown.Item onSelect={() => (focusTitleAfterClose = true)}>
                  <PencilIcon class="size-4 shrink-0" />
                  Rename
                </Dropdown.Item>
              </Show>
              <Show when={props.entityActions}>
                {(actions) => (
                  <Dropdown.Item
                    disabled={actions().duplicating}
                    onSelect={actions().onDuplicate}
                  >
                    <DuplicateIcon class="size-4 shrink-0" />
                    {t('entityActions.duplicate')}
                  </Dropdown.Item>
                )}
              </Show>
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
              <Dropdown.Item
                disabled={!props.table}
                onSelect={() => setWebhooksOpen(true)}
              >
                <WebhookIcon class="size-4 shrink-0" />
                Webhooks
              </Dropdown.Item>
              <Dropdown.Item onSelect={() => setSyncOpen(true)}>
                <ArrowsClockwiseIcon class="size-4 shrink-0" />
                {t('databaseSyncs.syncFrom')}
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
                  onSelect={() =>
                    fireAndForget(exportCsv(), 'database-page-actions')
                  }
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
      <Show when={webhooksOpen() && props.table}>
        {(table) => (
          <Show keyed when={`${props.detail.database.id}:${table().table.id}`}>
            <WebhooksDialog
              databaseId={props.detail.database.id}
              table={table()}
              onClose={() => setWebhooksOpen(false)}
              returnFocus={menuButton}
            />
          </Show>
        )}
      </Show>
      <Show when={syncOpen()}>
        <SyncDialog
          detail={props.detail}
          onTableAdded={props.onTableAdded}
          onClose={() => setSyncOpen(false)}
          returnFocus={menuButton}
        />
      </Show>
      <DeleteDialog
        open={confirmDelete()}
        onOpenChange={setConfirmDelete}
        title="Delete database?"
        pending={deleting()}
        onDelete={() =>
          fireAndForget(removeDatabase(), 'database-page-actions')
        }
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
