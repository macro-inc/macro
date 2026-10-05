import { useHasPaidAccess } from '@core/auth';
import { databaseModelForPlan } from '@core/component/AI/constant';
import { isFeatureEnabled, showDatabaseSql } from '@core/constant/featureFlags';
import { refreshInBackground } from '@queries/database-sql/create-database-sql-query';
import { useDatabaseQueryDefinition } from '@queries/storage/database-queries';
import {
  useDatabaseDetailQuery,
  useDatabasesQuery,
} from '@queries/storage/databases';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { AppAnswerDisplay } from './answer-display';
import { QueryDatabasePicker } from './components/query-database-picker';
import {
  type QueryDefinition,
  type QuerySchema,
  queryErrorMessage,
  type SavedQuestion,
} from './core/query';
import {
  createQueryCapabilities,
  createSavedQuestionSource,
  saveQuestionSql,
  trackQueryDatabase,
} from './queries/app-query-source';
import { toQuerySchema } from './queries/query-source';
import { saveQuestion } from './queries/saved-question';
import { LiveQuestion } from './views/live-question';
import { QueryEditor } from './views/query-editor';

/** Source selection for a question inserted from the document slash menu. */
export function ChooseQuestionSource(props: {
  initial: QueryDefinition;
  onSave: (definition: QueryDefinition) => void;
  saveOnGenerate?: boolean;
  saving?: boolean;
}) {
  const databases = useDatabasesQuery();
  const hasPaidAccess = useHasPaidAccess();
  const capabilities = createQueryCapabilities(() =>
    databaseModelForPlan(hasPaidAccess())
  );
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
    <AppAnswerDisplay>
      <QueryEditor
        autoFocus
        initial={{ ...props.initial, tableId: undefined }}
        schema={schema()}
        capabilities={capabilities}
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
        saveOnGenerate={props.saveOnGenerate}
        saving={props.saving}
        saveLabel={props.initial.sql ? 'Save changes' : 'Insert'}
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
    </AppAnswerDisplay>
  );
}

function SavedQuestionSql(props: { queryId: string }) {
  const definition = useDatabaseQueryDefinition(() => props.queryId);
  return (
    <Switch fallback="Loading SQL…">
      <Match when={definition.isSuccess && definition.data}>
        {(saved) => saved().definition.query}
      </Match>
      <Match when={definition.isError}>SQL unavailable</Match>
    </Switch>
  );
}

/** Asks a new question and saves its SQL as a query. */
function AskQuestion(props: {
  source: SavedQuestion;
  sql?: string;
  onSave: (source: SavedQuestion) => void;
}) {
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const save = async (next: QueryDefinition) => {
    if (saving()) return;
    setSaving(true);
    setError();
    const saved = await saveQuestion({
      definition: { ...next, height: props.source.height },
      save: saveQuestionSql,
    });
    setSaving(false);
    saved.match(props.onSave, (failure) =>
      setError(queryErrorMessage(failure, isFeatureEnabled(showDatabaseSql)))
    );
  };
  return (
    <>
      <ChooseQuestionSource
        initial={{ ...props.source, sql: props.sql ?? '' }}
        onSave={(next) => void save(next)}
        saveOnGenerate={!!props.source.queryId}
        saving={saving()}
      />
      <Show when={saving()}>
        <p role="status" class="px-4 pb-3 text-sm text-ink-muted">
          Saving question…
        </p>
      </Show>
      <Show when={error()}>
        <p role="alert" class="px-4 pb-3 text-sm text-failure-ink">
          {error()}
        </p>
      </Show>
    </>
  );
}

/** Saved SQL is loaded only when Details mounts the editor. */
function EditSavedQuestion(props: {
  source: SavedQuestion;
  onSave: (source: SavedQuestion) => void;
}) {
  const definition = useDatabaseQueryDefinition(() => props.source.queryId);
  return (
    <Switch
      fallback={
        <p role="status" class="p-4 text-sm text-ink-muted">
          Loading question…
        </p>
      }
    >
      <Match when={definition.isSuccess && definition.data}>
        {(saved) => (
          <AskQuestion
            source={props.source}
            sql={saved().definition.query}
            onSave={props.onSave}
          />
        )}
      </Match>
      <Match when={definition.isError}>
        <div class="p-4 text-sm">
          <p role="alert">This question could not be loaded.</p>
          <button
            class="mt-2 rounded px-2 py-1 hover:bg-hover"
            onClick={() => void definition.refetch()}
          >
            Retry
          </button>
        </div>
      </Match>
    </Switch>
  );
}

/** Refreshes on every change to one database while mounted; draws nothing. */
function TrackDatabase(props: { id: string; onChange: () => void }) {
  trackQueryDatabase(props.id, props.onChange);
  return null;
}

/** Production wiring is loaded only when a document query enters the viewport. */
export function DatabaseLiveQuestion(props: {
  source: SavedQuestion;
  onSave?: (source: SavedQuestion) => void;
  onDiscard?: () => void;
}) {
  const query = createSavedQuestionSource(() => props.source.queryId);
  // A failed read keeps the last answer's tracking, so a later change can
  // still recover it.
  const trackingIds = () =>
    Array.from(
      new Set([
        ...(props.source.databaseId ? [props.source.databaseId] : []),
        ...(query.answer()?.readDatabaseIds ?? []),
      ])
    );
  const refresh = () => refreshInBackground(query);
  return (
    <AppAnswerDisplay>
      <For each={trackingIds()}>
        {(id) => (
          <TrackDatabase
            id={id}
            onChange={() => {
              if (props.source.queryId) refresh();
            }}
          />
        )}
      </For>
      <LiveQuestion
        source={props.source}
        answer={query.answer()}
        loading={query.loading()}
        error={query.error()}
        onRefresh={refresh}
        onRename={
          props.onSave
            ? (title) => props.onSave?.({ ...props.source, title })
            : undefined
        }
        onResize={
          props.onSave
            ? (height) => props.onSave?.({ ...props.source, height })
            : undefined
        }
        sql={() => <SavedQuestionSql queryId={props.source.queryId} />}
        onDiscard={props.onDiscard}
        editor={
          props.onSave
            ? (onClose) => (
                <Show
                  when={props.source.queryId}
                  fallback={
                    <AskQuestion
                      source={props.source}
                      onSave={(source) => {
                        props.onSave?.(source);
                        onClose();
                      }}
                    />
                  }
                >
                  <EditSavedQuestion
                    source={props.source}
                    onSave={(source) => {
                      props.onSave?.(source);
                      onClose();
                    }}
                  />
                </Show>
              )
            : undefined
        }
      />
    </AppAnswerDisplay>
  );
}
