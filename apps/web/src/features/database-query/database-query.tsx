import {
  useDatabaseDetailQuery,
  useDatabasesQuery,
} from '@queries/storage/databases';
import type { DatabaseDetail } from '@service-storage/databases';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { QueryDatabasePicker } from './components/query-database-picker';
import type { QueryCapabilities } from './context/query-context';
import type { QueryAnswer, QueryDefinition, QuerySchema } from './core/query';
import {
  queryCapabilities,
  readLiveQuery,
  subscribeToQueryChanges,
  trackQueryDatabase,
} from './queries/app-query-source';
import { createLiveQuerySource, toQuerySchema } from './queries/query-source';
import { LiveQuestion } from './views/live-question';
import { QueryEditor } from './views/query-editor';

export function DatabaseQuestionPanel(props: {
  detail: DatabaseDetail;
  activeTableId?: string;
  initial?: QueryDefinition;
  onSave?: (definition: QueryDefinition, answer: QueryAnswer) => void;
  saveLabel?: string;
  saveHint?: string;
  sourcePicker?: JSX.Element;
  autoFocus?: boolean;
  capabilities?: QueryCapabilities;
  promptPlaceholder?: string;
}) {
  return (
    <QueryEditor
      autoFocus={props.autoFocus}
      schema={toQuerySchema(props.detail, props.activeTableId)}
      initial={
        props.initial ?? {
          databaseId: props.detail.database.id,
          sql: '',
          prompt: '',
          displayMode: 'scalar',
        }
      }
      capabilities={props.capabilities ?? queryCapabilities}
      promptPlaceholder={props.promptPlaceholder}
      onSave={props.onSave}
      saveLabel={props.saveLabel}
      saveHint={props.saveHint}
      sourcePicker={props.sourcePicker}
    />
  );
}

/** Source selection for a question inserted from the document slash menu. */
export function ChooseQuestionSource(props: {
  initial: QueryDefinition;
  onSave: (definition: QueryDefinition) => void;
}) {
  const databases = useDatabasesQuery();
  const [databaseId, setDatabaseId] = createSignal(props.initial.databaseId);
  const availableDatabases = () =>
    !databases.isPending ? (databases.data ?? []) : [];
  const detail = useDatabaseDetailQuery(databaseId);
  const loadedDetail = () => {
    if (detail.isPending || !databaseId()) return undefined;
    const current = detail.data;
    return current?.database.id === databaseId() ? current : undefined;
  };
  const schema = (): QuerySchema => {
    const current = loadedDetail();
    return current
      ? toQuerySchema(current)
      : {
          databaseId: databaseId(),
          name: databaseId()
            ? (availableDatabases().find(
                (entry) => entry.database.id === databaseId()
              )?.database.name ?? 'Database unavailable')
            : 'Automatic',
          tables: [],
        };
  };
  return (
    <>
      <QueryEditor
        autoFocus
        initial={{ ...props.initial, tableId: undefined }}
        schema={schema()}
        capabilities={queryCapabilities}
        sourceAvailable={!databaseId() || !!loadedDetail()}
        sourcePicker={(resolvedSchema) => (
          <QueryDatabasePicker
            databases={availableDatabases().map(({ database }) => ({
              id: database.id,
              name: database.name,
            }))}
            value={databaseId()}
            resolvedName={
              resolvedSchema().databaseId ? resolvedSchema().name : undefined
            }
            loading={databases.isPending}
            onChange={setDatabaseId}
          />
        )}
        onSave={props.onSave}
        saveLabel={props.initial.sql ? 'Save changes' : 'Insert answer'}
      />
      <Show when={databaseId() && detail.isError}>
        <p role="alert" class="px-4 pb-3 text-sm text-failure-ink">
          This database could not be opened. Choose Automatic or another source.
        </p>
      </Show>
      <Show when={databaseId() && detail.isPending}>
        <p role="status" class="px-4 pb-3 text-sm text-ink-muted">
          Loading database…
        </p>
      </Show>
    </>
  );
}

/** Production wiring is loaded only when a document query enters the viewport. */
export function DatabaseLiveQuestion(props: {
  source: QueryDefinition;
  onSave?: (source: QueryDefinition) => void;
}) {
  const query = createLiveQuerySource({
    sql: () => props.source.sql,
    read: readLiveQuery,
    subscribe: subscribeToQueryChanges,
  });
  const trackingIds = () =>
    Array.from(
      new Set([
        ...(props.source.databaseId ? [props.source.databaseId] : []),
        ...(!query.isPending ? (query.data?.read_database_ids ?? []) : []),
      ])
    );
  return (
    <>
      <For each={trackingIds()}>
        {(id) => {
          trackQueryDatabase(id, () => {
            if (props.source.sql.trim()) void query.refetch();
          });
          return null;
        }}
      </For>
      <LiveQuestion
        source={props.source}
        answer={query.isSuccess ? query.data : undefined}
        loading={query.isFetching}
        error={query.isError ? query.error : undefined}
        onRefresh={() => void query.refetch()}
        onRename={
          props.onSave
            ? (title) => props.onSave?.({ ...props.source, title })
            : undefined
        }
        editor={
          props.onSave
            ? (onClose) => (
                <ChooseQuestionSource
                  initial={props.source}
                  onSave={(source) => {
                    props.onSave?.(source);
                    onClose();
                  }}
                />
              )
            : undefined
        }
      />
    </>
  );
}
