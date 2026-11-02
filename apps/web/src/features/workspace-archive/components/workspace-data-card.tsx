import { SettingsCard, SettingsRow } from '@app/features/settings/primitives';
import IconDownload from '@icon/system/regular/download-simple.svg?component-solid';
import IconUpload from '@icon/system/regular/upload-simple.svg?component-solid';
import { Button } from '@ui';

export type WorkspaceDataStatus =
  | { phase: 'idle' }
  | { phase: 'exporting'; done: number; total: number | undefined }
  | { phase: 'importing'; done: number };

function exportLabel(status: WorkspaceDataStatus): string {
  if (status.phase !== 'exporting') return 'Export';
  if (status.done === 0) return `Listing ${status.total ?? 0}…`;
  return `Exporting ${status.done} of ${status.total ?? 0}…`;
}

function importLabel(status: WorkspaceDataStatus): string {
  return status.phase === 'importing' ? `Imported ${status.done}…` : 'Import';
}

export function WorkspaceDataCard(props: {
  status: WorkspaceDataStatus;
  onExport: () => void;
  onImport: () => void;
}) {
  const busy = () => props.status.phase !== 'idle';
  return (
    <SettingsCard>
      <SettingsRow
        label="Export workspace"
        description="Download everything you can access as one compressed archive."
      >
        <Button
          variant="secondary"
          size="sm"
          disabled={busy()}
          onClick={() => props.onExport()}
        >
          <IconDownload class="size-4" />
          {exportLabel(props.status)}
        </Button>
      </SettingsRow>
      <SettingsRow
        label="Import workspace"
        description="Restore folders, documents, tasks and files from a Macro export."
      >
        <Button
          variant="secondary"
          size="sm"
          disabled={busy()}
          onClick={() => props.onImport()}
        >
          <IconUpload class="size-4" />
          {importLabel(props.status)}
        </Button>
      </SettingsRow>
    </SettingsCard>
  );
}
