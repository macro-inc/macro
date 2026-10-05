/**
 * Tool renderers for the Macro Databases toolsets: QueryDatabase and
 * SaveDatabaseQuery from `crates/databases_sql/src/toolset`, the rest from
 * `crates/databases/src/inbound/toolset`.
 */

import { AppAnswerDisplay } from '@app/features/database-query/answer-display';
import { toolAnswers } from '@app/features/database-query/core/tool-answer';
import { ToolQueryResults } from '@app/features/database-query/views/tool-query-results';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { isFeatureEnabled, showDatabaseSql } from '@core/constant/featureFlags';
import { decodeHtmlEntities } from '@macro-inc/lexical-core/utils/html-entities';
import DatabaseIcon from '@phosphor/database.svg';
import TableIcon from '@phosphor/table.svg';
import {
  invalidateDatabase,
  useDatabaseDetailQuery,
} from '@queries/storage/databases';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { createSignal, For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { BaseTool } from './BaseTool';
import type { DatabaseToolHandlerMap } from './DatabaseToolHandlers';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type DatabaseSchema = NamedTool<'DescribeDatabase', 'response'>['data'];
type QueryDatabaseResult = NamedTool<'QueryDatabase', 'response'>['data'];

function count(amount: number, noun: string) {
  return `${amount} ${noun}${amount === 1 ? '' : 's'}`;
}

function rowCount(amount: number) {
  return amount === 0 ? 'no rows' : count(amount, 'row');
}

/** What a QueryDatabase call did, in words, for when SQL is hidden. */
function describeDatabaseQuery(input: {
  result: QueryDatabaseResult;
  tableName: (tableId: string) => string | undefined;
  databaseName: string | undefined;
}): string {
  const changed = input.result.changesApplied;
  return match(input.result.statement)
    .with({ kind: 'schema' }, ({ summary }) => summary)
    .with({ kind: 'select' }, () => {
      const read = [
        ...new Set(
          input.result.readVersions
            .map((table) => input.tableName(table.tableId))
            .filter((name): name is string => !!name)
        ),
      ].join(', ');
      if (read) return `Read ${read}`;
      return input.databaseName
        ? `Queried ${input.databaseName}`
        : 'Queried database';
    })
    .with(
      { kind: 'insert' },
      ({ tableName }) => `Added ${rowCount(changed)} to ${tableName}`
    )
    .with(
      { kind: 'update' },
      ({ tableName }) => `Updated ${rowCount(changed)} in ${tableName}`
    )
    .with(
      { kind: 'delete' },
      ({ tableName }) => `Deleted ${rowCount(changed)} from ${tableName}`
    )
    .with(
      { kind: 'alterColumnType' },
      ({ columnName, tableName, to }) =>
        `Changed ${columnName} in ${tableName} to ${to}`
    )
    .exhaustive();
}

function SchemaTableList(props: { schema: DatabaseSchema }) {
  return (
    <Tool.List>
      <For each={props.schema.tables}>
        {(table) => (
          <Tool.ListItem icon={<TableIcon class="size-3" />}>
            <div class="min-w-0 truncate text-ink text-xs">
              {table.name}
              <span class="pl-1.5 text-ink-extra-muted">
                {table.columns.map((column) => column.name).join(', ')}
              </span>
            </div>
          </Tool.ListItem>
        )}
      </For>
    </Tool.List>
  );
}

const listDatabasesHandler = createToolRenderer({
  name: 'ListDatabases',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const databases = () => ctx.response?.data.databases ?? [];

    return (
      <BaseTool
        icon={DatabaseIcon}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && databases().length > 0 ? (
            <Tool.List>
              <For each={databases()}>
                {(database) => (
                  <Tool.ListItem icon={<TableIcon class="size-3" />}>
                    <div class="min-w-0 text-ink text-xs">
                      <span class="block truncate">{database.name}</span>
                      <span class="block truncate text-ink-muted">
                        {database.tables?.map((table) => table.name).join(', ')}
                      </span>
                    </div>
                  </Tool.ListItem>
                )}
              </For>
            </Tool.List>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0 truncate">Find database tables</span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((open) => !open)}
            showToggle={databases().length > 0}
            status={
              ctx.response
                ? `${databases().length} database${databases().length === 1 ? '' : 's'}`
                : undefined
            }
          />
        </div>
      </BaseTool>
    );
  },
});

const describeDatabaseHandler = createToolRenderer({
  name: 'DescribeDatabase',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const schema = () => ctx.response?.data;
    const status = () => {
      const current = schema();
      if (!current) return undefined;
      const count = current.tables.length;
      return `${count} table${count === 1 ? '' : 's'}`;
    };

    return (
      <BaseTool
        icon={DatabaseIcon}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && schema() ? (
            <SchemaTableList schema={schema()!} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0 truncate">
            Read database{' '}
            <span class="text-ink">
              {schema()?.name ?? ctx.tool.data.databaseId}
            </span>
          </span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((open) => !open)}
            showToggle={!!schema()}
            status={status()}
          />
        </div>
      </BaseTool>
    );
  },
});

const queryDatabaseHandler = createToolRenderer({
  name: 'QueryDatabase',
  render: (ctx) => {
    const [chosen, setChosen] = createSignal<boolean>();
    // A saved question later in the turn shows the same answer, so this one starts folded.
    const expanded = () =>
      chosen() ?? !ctx.renderContext.followedBy('SaveDatabaseQuery');
    const showSql = isFeatureEnabled(showDatabaseSql);
    // A read carries only table ids; its plain-words title names them from the schema.
    const detailQuery = useDatabaseDetailQuery(() =>
      !showSql && ctx.response?.data.statement.kind === 'select'
        ? (ctx.tool.data.databaseId ?? undefined)
        : undefined
    );
    const detail = () => (detailQuery.isSuccess ? detailQuery.data : undefined);
    const title = () => {
      const result = ctx.response?.data;
      if (!result) return 'Query database';
      if (showSql) return result.summary || 'Query database';
      return describeDatabaseQuery({
        result,
        tableName: (tableId) =>
          detail()?.tables.find((table) => table.table.id === tableId)?.table
            .name,
        databaseName: detail()?.database.name,
      });
    };
    const answers = () => {
      const data = ctx.response?.data;
      return data ? toolAnswers(data) : [];
    };
    return (
      <BaseTool
        icon={DatabaseIcon}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && answers().length ? (
            <For each={answers()}>
              {(answer) => (
                <AppAnswerDisplay>
                  <ToolQueryResults
                    answer={answer}
                    sql={ctx.tool.data.sql}
                    preferredDisplay={ctx.tool.data.display ?? undefined}
                    showSql={showSql}
                  />
                </AppAnswerDisplay>
              )}
            </For>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0 truncate">{title()}</span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setChosen(!expanded())}
            showToggle={answers().length > 0}
          />
        </div>
      </BaseTool>
    );
  },
});

const saveDatabaseViewHandler = createToolRenderer({
  name: 'SaveDatabaseView',
  handleResponse: async (ctx) => {
    const databaseId = ctx.tool.data.view.databaseId;
    if (typeof databaseId === 'string') await invalidateDatabase(databaseId);
  },
  render: (ctx) => {
    const orchestrator = useGlobalBlockOrchestrator();
    async function openView() {
      const viewId = ctx.response?.data.view.id;
      if (typeof viewId !== 'string') return;
      globalSplitManager()?.openWithSplit(
        { type: 'database', id: ctx.tool.data.databaseId },
        { activate: true }
      );
      const handle = await orchestrator.getBlockHandle(
        ctx.tool.data.databaseId,
        'database'
      );
      await handle?.goToLocationFromParams({
        tableId: ctx.tool.data.tableId,
        viewId,
      });
    }
    return (
      <BaseTool icon={TableIcon} renderContext={ctx.renderContext} type="call">
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0 truncate">
            {ctx.response ? 'Saved' : 'Save'}{' '}
            {ctx.tool.data.layout.kind === 'board' ? 'board' : 'view'}{' '}
            <span class="text-ink">{ctx.tool.data.name}</span>
          </span>
          <Show when={ctx.response}>
            <button
              type="button"
              class="shrink-0 rounded px-2 py-1 text-xs text-ink hover:bg-hover"
              onClick={() => void openView()}
            >
              Open view
            </button>
          </Show>
        </div>
      </BaseTool>
    );
  },
});

const deleteDatabaseViewHandler = createToolRenderer({
  name: 'DeleteDatabaseView',
  handleResponse: async (ctx) => {
    await invalidateDatabase(ctx.tool.data.databaseId);
  },
  render: (ctx) => (
    <BaseTool icon={TableIcon} renderContext={ctx.renderContext} type="call">
      <span class="min-w-0 truncate">
        {ctx.response ? 'Deleted view' : 'Delete view'}
        <Show when={ctx.response}>
          {(response) => (
            <>
              {' '}
              <span class="text-ink">{response().data.name}</span>
            </>
          )}
        </Show>
      </span>
    </BaseTool>
  ),
});

const saveDatabaseQueryHandler = createToolRenderer({
  name: 'SaveDatabaseQuery',
  render: (ctx) => {
    // The saved question is pasted into the reply too, so its preview starts folded.
    const [expanded, setExpanded] = createSignal(false);
    const markdown = () => ctx.response?.data.markdown;
    return (
      <BaseTool
        icon={DatabaseIcon}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && markdown() ? (
            <div class="min-w-0 p-3">
              <StaticMarkdownContext>
                <StaticMarkdown
                  markdown={markdown()!}
                  target="internal"
                  lazy={false}
                />
              </StaticMarkdownContext>
            </div>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0 truncate">
            {ctx.response ? 'Saved' : 'Save'} question{' '}
            <span class="text-ink">
              {decodeHtmlEntities(ctx.tool.data.title)}
            </span>
          </span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((open) => !open)}
            showToggle={!!ctx.response}
          />
        </div>
      </BaseTool>
    );
  },
});

export const databaseToolHandlers: DatabaseToolHandlerMap = {
  ListDatabases: listDatabasesHandler,
  DescribeDatabase: describeDatabaseHandler,
  QueryDatabase: queryDatabaseHandler,
  SaveDatabaseView: saveDatabaseViewHandler,
  DeleteDatabaseView: deleteDatabaseViewHandler,
  SaveDatabaseQuery: saveDatabaseQueryHandler,
};
