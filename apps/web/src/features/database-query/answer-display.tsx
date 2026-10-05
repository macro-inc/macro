import {
  DatabaseMentionValue,
  DatabaseTextValue,
} from '@app/features/block-database/database-mentions';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { toast } from '@core/component/Toast/Toast';
import { useDatabasesQuery } from '@queries/storage/databases';
import { type JSX, Show } from 'solid-js';
import {
  type AnswerDisplay,
  AnswerDisplayProvider,
  type AnswerRow,
} from './context/answer-display';
import { answerNames } from './queries/answer-names';

/** A `row_id` as a link that opens its row, once its table's database is known. */
function AnswerRowLink(props: AnswerRow) {
  const orchestrator = useGlobalBlockOrchestrator();
  const listed = useDatabasesQuery();
  const destination = () => {
    const tableId = props.table;
    if (!tableId || !listed.isSuccess) return undefined;
    const table = listed.data
      .flatMap((entry) => entry.tables)
      .find((candidate) => candidate.id === tableId);
    return table ? { databaseId: table.database_id, tableId } : undefined;
  };
  async function open(databaseId: string, tableId: string) {
    globalSplitManager()?.openWithSplit(
      { type: 'database', id: databaseId },
      { activate: true }
    );
    try {
      const handle = await orchestrator.getBlockHandle(databaseId, 'database');
      await handle?.goToLocationFromParams({ tableId, rowId: props.id });
    } catch {
      toast.failure('This record could not be opened.');
    }
  }
  return (
    <Show when={destination()} fallback={props.label}>
      {(target) => (
        <button
          type="button"
          class="max-w-full truncate text-left text-accent hover:underline"
          onClick={() => void open(target().databaseId, target().tableId)}
        >
          {props.label}
        </button>
      )}
    </Show>
  );
}

/** Answers drawn with the database grid's names, mentions and text. */
const appAnswerDisplay: AnswerDisplay = {
  names: answerNames,
  mention: (id, entityType) => (
    <DatabaseMentionValue id={id} entityType={entityType} />
  ),
  row: (row) => <AnswerRowLink {...row} />,
  text: (markdown) => <DatabaseTextValue value={markdown} />,
};

export function AppAnswerDisplay(props: { children: JSX.Element }) {
  return (
    <AnswerDisplayProvider value={appAnswerDisplay}>
      {props.children}
    </AnswerDisplayProvider>
  );
}
