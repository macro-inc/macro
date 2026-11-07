import { downloadFile } from '@app/lib/filesystem/download';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { openFilePicker } from '@core/util/filePicker';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { createSignal } from 'solid-js';
import {
  WorkspaceDataCard,
  type WorkspaceDataStatus,
} from './components/workspace-data-card';
import { ArchiveFormatError } from './core/archive';
import {
  exportWorkspace,
  type ImportReport,
  importWorkspace,
} from './primitives/workspace-archive';
import { workspaceSource } from './queries/workspace-source';
import { workspaceTarget } from './queries/workspace-target';

function archiveName(now: Date): string {
  return `macro-workspace-${now.toISOString().slice(0, 10)}.tar.gz`;
}

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof ArchiveFormatError ? error.message : fallback;
}

function importSummary(report: ImportReport): string {
  const skipped = Object.values(report.notRestorable).reduce(
    (sum, count) => sum + count,
    0
  );
  const parts = [`Restored ${report.restored} items.`];
  if (skipped > 0)
    parts.push(
      `${skipped} synced or shared items stay in the archive but aren't restored.`
    );
  if (report.failed.length > 0)
    parts.push(`${report.failed.length} couldn't be restored.`);
  return parts.join(' ');
}

/** Settings → Account card that exports and imports the whole workspace. */
export function WorkspaceDataSettings() {
  const userId = useUserId();
  const [status, setStatus] = createSignal<WorkspaceDataStatus>({
    phase: 'idle',
  });

  const runExport = () =>
    Telemetry.span('workspace_archive.export', async (span) => {
      const now = new Date();
      setStatus({ phase: 'exporting', done: 0, total: undefined });
      try {
        const archive = await exportWorkspace({
          source: workspaceSource,
          exportedBy: userId() ?? '',
          now,
          onProgress: ({ done, total }) => {
            span.setAttr('workspace_archive.items', total ?? 0);
            setStatus({ phase: 'exporting', done, total });
          },
        });
        const blob = await new Response(archive).blob();
        span.setAttr('workspace_archive.bytes', blob.size);
        await downloadFile(blob, archiveName(now));
      } catch (error) {
        span.error(error);
        toast.failure(failureMessage(error, 'Unable to export your workspace'));
      } finally {
        setStatus({ phase: 'idle' });
      }
    });

  const runImport = (file: File) =>
    Telemetry.span('workspace_archive.import', async (span) => {
      span.setAttr('workspace_archive.bytes', file.size);
      setStatus({ phase: 'importing', done: 0 });
      try {
        const report = await importWorkspace({
          archive: file.stream(),
          target: workspaceTarget,
          onProgress: ({ done }) => setStatus({ phase: 'importing', done }),
        });
        span.setAttr('workspace_archive.restored', report.restored);
        span.setAttr('workspace_archive.failed', report.failed.length);
        if (report.failed.length > 0) toast.alert(importSummary(report));
        else toast.success(importSummary(report));
      } catch (error) {
        span.error(error);
        toast.failure(failureMessage(error, 'Unable to import this archive'));
      } finally {
        setStatus({ phase: 'idle' });
      }
    });

  return (
    <WorkspaceDataCard
      status={status()}
      onExport={() => fireAndForget(runExport(), 'workspace-archive-export')}
      onImport={() =>
        openFilePicker({ multiple: false }, (files) => {
          const [file] = files;
          if (file) fireAndForget(runImport(file), 'workspace-archive-import');
        })
      }
    />
  );
}
