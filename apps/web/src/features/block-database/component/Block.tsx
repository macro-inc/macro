import { useBlockId } from '@core/block';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { toast } from '@core/component/Toast/Toast';
import DownloadIcon from '@phosphor/download-simple.svg';
import TerminalIcon from '@phosphor/terminal-window.svg';
import {
  downloadDatabaseSnapshot,
  useDatabaseDetailQuery,
} from '@queries/storage/databases';
import { useDatabaseTableChangedSync } from '@queries/storage/databases-sync';
import type { DatabaseTableDetail } from '@service-storage/databases';
import { Button } from '@ui';
import {
  type Component,
  createMemo,
  createSignal,
  ErrorBoundary,
  For,
  Show,
  Suspense,
} from 'solid-js';
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
    let url: string | undefined;
    try {
      const blob = await downloadDatabaseSnapshot(databaseId);
      url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${detailQuery.data?.database.name ?? 'database'}.sqlite`;
      // Firefox only follows a click on an anchor that is in the document.
      document.body.append(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('database snapshot download failed', error);
      toast.failure('Could not download this database');
    } finally {
      // The click starts the download asynchronously; revoking in this tick
      // can cancel it, so let the task queue drain first.
      const objectUrl = url;
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    }
  };

  return (
    <DocumentBlockContainer>
      <div class="flex size-full min-h-0 flex-col bg-canvas-base">
        <div class="flex shrink-0 items-center justify-between gap-2 border-edge border-b px-3 py-2">
          <span class="truncate font-medium text-ink text-sm">
            {detailQuery.data?.database.name ?? 'Database'}
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

        {/*
          The block owns its own loading and error surfaces: without them the
          first read of `detailQuery.data` suspends all the way out to the
          route boundary and blanks the document around the block.
        */}
        <ErrorBoundary
          fallback={(error: unknown) => (
            <div class="grid flex-1 place-items-center p-4 text-failure-ink text-xs">
              {error instanceof Error
                ? error.message
                : 'Could not open this database.'}
            </div>
          )}
        >
          <Suspense fallback={<DatabaseSkeleton />}>
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
                    This database has no tables yet.
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
          </Suspense>
        </ErrorBoundary>
      </div>
    </DocumentBlockContainer>
  );
};

/** Tab strip and grid placeholders, shaped like what replaces them. */
function DatabaseSkeleton() {
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2 p-2" aria-busy="true">
      <div class="flex gap-2">
        <For each={[0, 1]}>
          {() => <div class="h-5 w-20 animate-pulse rounded-sm bg-hover" />}
        </For>
      </div>
      <For each={[0, 1, 2, 3, 4]}>
        {() => <div class="h-6 animate-pulse rounded-sm bg-hover" />}
      </For>
    </div>
  );
}

export default Block;
