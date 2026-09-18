import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { toast } from '@core/component/Toast/Toast';
import DownloadIcon from '@phosphor/download-simple.svg';
import TerminalIcon from '@phosphor/terminal-window.svg';
import {
  useDatabaseDetailQuery,
  useDatabaseTableChangedSync,
} from '@queries/storage/databases';
import { storageServiceClient } from '@service-storage/client';
import type { DatabaseTableDetail } from '@service-storage/databases';
import { Button } from '@ui';
import { type Component, createMemo, createSignal, Show } from 'solid-js';
import { DatabaseGrid } from './DatabaseGrid';
import { SqlConsole } from './SqlConsole';
import { TableTabs } from './TableTabs';

const Block: Component = () => {
  const databaseId = useBlockId();
  useDatabaseTableChangedSync(() => databaseId);

  const detailQuery = useDatabaseDetailQuery(() => databaseId);
  const [selectedTableId, setSelectedTableId] = createSignal<string>();
  const [consoleOpen, setConsoleOpen] = createSignal(false);

  const tables = (): DatabaseTableDetail[] => detailQuery.data?.tables ?? [];
  const activeTable = createMemo(
    () =>
      tables().find((table) => table.table.id === selectedTableId()) ??
      tables()[0]
  );
  const canEdit = () => {
    const grant = detailQuery.data?.grant;
    return grant === 'edit' || grant === 'owner';
  };

  const downloadSnapshot = async () => {
    try {
      const blob = await storageServiceClient.databases.downloadSqlite({
        id: databaseId,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${detailQuery.data?.database.name ?? 'database'}.sqlite`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('database snapshot download failed', error);
      toast.failure('Could not download this table');
    }
  };

  return (
    <DocumentBlockContainer>
      <div class="flex size-full min-h-0 flex-col bg-canvas-base">
        <div class="flex shrink-0 items-center justify-between gap-2 border-edge border-b px-3 py-2">
          <span class="truncate font-medium text-ink text-sm">
            {detailQuery.data?.database.name ?? 'Table'}
          </span>
          <div class="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConsoleOpen((open) => !open)}
              aria-pressed={consoleOpen()}
            >
              <TerminalIcon class="size-3.5" />
              SQL
            </Button>
            <Button variant="ghost" size="sm" onClick={downloadSnapshot}>
              <DownloadIcon class="size-3.5" />
              Download .sqlite
            </Button>
          </div>
        </div>

        <TableTabs
          databaseId={databaseId}
          tables={tables()}
          activeTableId={activeTable()?.table.id}
          canEdit={canEdit()}
          onSelect={setSelectedTableId}
        />

        <div class="flex min-h-0 flex-1 flex-col">
          <Show
            when={activeTable()}
            fallback={
              <div class="grid flex-1 place-items-center text-ink-muted text-xs">
                This table has no tabs yet.
              </div>
            }
          >
            {(table) => (
              <DatabaseGrid
                databaseId={databaseId}
                table={table()}
                canEdit={canEdit()}
              />
            )}
          </Show>

          <Show when={consoleOpen() && detailQuery.data}>
            {(detail) => (
              <SqlConsole
                detail={detail()}
                onClose={() => setConsoleOpen(false)}
              />
            )}
          </Show>
        </div>
      </div>
    </DocumentBlockContainer>
  );
};

export default Block;
