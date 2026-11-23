import '@app/index.css';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Avatar } from '@ui';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import {
  DatabaseLinkValue,
  DatabaseTextEditor,
  DatabaseTextValue,
} from '../../block-database/database-mentions';
import { DatabaseMentionLabel } from '../../database/components/database-mention-label';
import { GridCell } from '../../database/components/grid-cell';
import type { DatabaseCellValue } from '../../database/core/database-view';
import { applyTheme } from '../../theme/utils/themeUtils';
import { PipelineEntryCards } from '../components/pipeline-entry-cards';
import { RecordOverview } from '../components/record-overview';
import type { PipelineEntry } from '../core/pipeline-entry';
import {
  contactPipelineEntry,
  FIXTURE_OWNER,
} from '../tests/pipeline-entry-fixture';

// The record page's Pipelines card over a local row: the cells and their
// writes are the adapter's, the storage is a signal.
const params = new URLSearchParams(location.search);
applyTheme(params.get('theme') === 'dark' ? 'Macro Dark' : 'Macro Light');
document.documentElement.dataset.touchDevice = String(
  matchMedia('(pointer: coarse)').matches
);

function Fixture() {
  const [entry, setEntry] = createSignal<PipelineEntry>(
    contactPipelineEntry({ canEdit: params.get('editable') !== 'false' })
  );
  const [writes, setWrites] = createSignal(0);
  const write = async (columnId: string, value: DatabaseCellValue) => {
    setWrites((count) => count + 1);
    setEntry((current) => ({
      ...current,
      cells: current.cells.map((cell) =>
        cell.column.id === columnId ? { ...cell, value } : cell
      ),
    }));
    return true;
  };
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <main class="flex h-dvh flex-col bg-panel text-ink">
        <output aria-label="Pipeline writes" class="sr-only">
          {writes()}
        </output>
        <RecordOverview>
          <StaticMarkdownContext>
            <PipelineEntryCards
              entries={[entry()]}
              onOpenPipeline={() => {}}
              renderCell={(entry, cell, display) => (
                <GridCell
                  column={cell().column}
                  value={cell().value}
                  wrap={display.fit !== 'line'}
                  emptyLabel={display.emptyLabel}
                  canEdit={entry().pipeline.canEdit}
                  layout="property"
                  renderTextEditor={(editor) => (
                    <DatabaseTextEditor {...editor} />
                  )}
                  renderTextValue={(value) => (
                    <DatabaseTextValue value={value} fit={display.fit} />
                  )}
                  renderLinkValue={(url) => <DatabaseLinkValue url={url} />}
                  renderMentionValue={(_, entityType) => (
                    <DatabaseMentionLabel
                      entityType={entityType}
                      name={FIXTURE_OWNER.name}
                      icon={
                        // The face UserIcon shows a person without a picture.
                        <Avatar size="sm" aria-hidden="true">
                          <Avatar.Fallback class="font-semibold">
                            PR
                          </Avatar.Fallback>
                        </Avatar>
                      }
                    />
                  )}
                  onWrite={(value) => write(cell().column.id, value)}
                  onAddOption={(label, value) =>
                    write(cell().column.id, value ?? label)
                  }
                />
              )}
            />
          </StaticMarkdownContext>
        </RecordOverview>
      </main>
    </QueryClientProvider>
  );
}
render(Fixture, document.getElementById('root')!);
