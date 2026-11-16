import ImportLinear from '@app/features/integrations/import-linear/ImportLinear';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import { ACCESS, reads } from './calendar-guests-fixture';
import {
  holdImportReferences,
  importLookupReads,
  importReferenceReads,
  releaseImportReferences,
} from './import-contact-network';
import {
  holdTaskWrite,
  notices,
  releaseTaskWrite,
  taskHistory,
  taskWrites,
} from './linear-import-adapters';
import { changeViewer } from './network';
import { account, setAccount } from './task-filter-adapters';

export function LinearImportFixture() {
  changeViewer('macro|viewer@example.com');
  return (
    <QuickAccessContextProvider value={ACCESS}>
      <main class="h-dvh overflow-auto bg-page text-ink">
        <div class="h-[75vh]">
          <ImportLinear />
        </div>
        <div class="flex flex-wrap gap-3 p-3">
          <button onClick={holdImportReferences}>Hold references</button>
          <button onClick={releaseImportReferences}>Release references</button>
          <button onClick={holdTaskWrite}>Hold task creation</button>
          <button onClick={releaseTaskWrite}>Release task creation</button>
          <button
            onClick={() =>
              setAccount({ ...account(), session: account().session + 1 })
            }
          >
            Replace login
          </button>
        </div>
        <output hidden data-testid="import-reference-reads">
          {JSON.stringify(importReferenceReads())}
        </output>
        <output hidden data-testid="import-lookups">
          {JSON.stringify(importLookupReads())}
        </output>
        <output hidden data-testid="import-picker-reads">
          {reads()}
        </output>
        <output hidden data-testid="import-writes">
          {JSON.stringify(taskWrites())}
        </output>
        <output hidden data-testid="import-write-count">
          {taskWrites().length}
        </output>
        <output hidden data-testid="import-history">
          {JSON.stringify(taskHistory())}
        </output>
        <output hidden data-testid="import-notices">
          {JSON.stringify(notices())}
        </output>
      </main>
    </QuickAccessContextProvider>
  );
}
