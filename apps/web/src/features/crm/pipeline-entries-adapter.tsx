import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import { createSignal } from 'solid-js';
import {
  DatabaseMentionPicker,
  DatabaseMentionValue,
  DatabaseTextEditor,
  DatabaseTextValue,
} from '../block-database/database-mentions';
import { GridCell } from '../database/components/grid-cell';
import type { DatabaseCellValue } from '../database/core/database-view';
import { databaseWriteMessage } from '../database/core/write-failure';
import { PipelineEntryCards } from './components/pipeline-entry-cards';
import type { PipelineEntriesView } from './context/pipelines';
import type { PipelineEntry, PipelineEntryCell } from './core/pipeline-entry';
import {
  createPipelineEntriesQuery,
  type PipelineEntriesDependencies,
  savePipelineEntryCell,
} from './queries/pipeline-entries';

const cellKey = (entry: PipelineEntry, cell: PipelineEntryCell) =>
  `${entry.rowId}:${cell.column.id}`;

/** The record's pipeline rows as cards, edited through each pipeline's ops. */
export function createCrmPipelineEntries(
  deps: PipelineEntriesDependencies
): PipelineEntriesView {
  return (props) => {
    const query = createPipelineEntriesQuery(deps.graphql, () => props.record);
    // A saved value shows until the refetched row replaces it.
    const [pending, setPending] = createSignal<
      Record<string, DatabaseCellValue>
    >({});
    const settle = (key: string) => setPending(({ [key]: _, ...rest }) => rest);
    const shownValue = (entry: PipelineEntry, cell: PipelineEntryCell) => {
      const written = pending();
      const key = cellKey(entry, cell);
      return key in written ? written[key] : cell.value;
    };
    async function write(
      entry: PipelineEntry,
      cell: PipelineEntryCell,
      value: DatabaseCellValue,
      option?: string
    ) {
      if (!entry.pipeline.canEdit || !cell.column.writable) return false;
      if (option === undefined && shownValue(entry, cell) === value)
        return true;
      const key = cellKey(entry, cell);
      setPending((written) => ({ ...written, [key]: value }));
      const saved = await savePipelineEntryCell(
        deps.storage,
        entry,
        cell,
        value,
        option !== undefined
      );
      if (saved.isErr()) {
        settle(key);
        toast.failure(databaseWriteMessage(saved.error));
        return false;
      }
      await query.refetch();
      settle(key);
      return true;
    }
    return (
      <StaticMarkdownContext>
        <PipelineEntryCards
          entries={query.entries()}
          onOpenPipeline={props.onOpenPipeline}
          renderCell={(entry, cell) => (
            <GridCell
              column={cell().column}
              value={shownValue(entry(), cell())}
              canEdit={entry().pipeline.canEdit}
              renderTextEditor={(editor) => <DatabaseTextEditor {...editor} />}
              renderTextValue={(value) => <DatabaseTextValue value={value} />}
              renderMentionPicker={(picker) => (
                <DatabaseMentionPicker {...picker} />
              )}
              renderMentionValue={(id, entityType) => (
                <DatabaseMentionValue id={id} entityType={entityType} />
              )}
              onMention={(mention) => write(entry(), cell(), mention.id)}
              onWrite={(value) => write(entry(), cell(), value)}
              onAddOption={(label, value) =>
                write(entry(), cell(), value ?? label, label)
              }
            />
          )}
        />
      </StaticMarkdownContext>
    );
  };
}
