/**
 * Tool renderers for the Macro Databases toolset
 * (`crates/databases/src/inbound/toolset`).
 */
import DatabaseIcon from '@phosphor/database.svg';
import TableIcon from '@phosphor/table.svg';
import TerminalIcon from '@phosphor/terminal-window.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { createSignal, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type DatabaseSchema = NamedTool<'DescribeDatabase', 'response'>['data'];
type ResultSet = NamedTool<
  'QueryDatabase',
  'response'
>['data']['results'][number];

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

function ResultTable(props: { result: ResultSet }) {
  return (
    <div class="overflow-auto p-2">
      <table class="w-max border-collapse text-left text-xs">
        <thead>
          <tr>
            <For each={props.result.columns}>
              {(column) => (
                <th class="border-edge border-b px-2 py-1 font-medium text-ink-muted">
                  {column.name}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={props.result.rows}>
            {(row) => (
              <tr>
                <For each={row}>
                  {(cell) => (
                    <td class="border-edge/60 border-b px-2 py-1 text-ink">
                      {cell === null || cell === undefined ? '' : String(cell)}
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <Show when={props.result.rows.length === 0}>
        <div class="px-2 py-1 text-ink-extra-muted text-xs">No rows.</div>
      </Show>
    </div>
  );
}

export const listDatabasesHandler = createToolRenderer({
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
                    <div class="truncate text-ink text-xs">{database.name}</div>
                  </Tool.ListItem>
                )}
              </For>
            </Tool.List>
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0 truncate">List tables</span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((open) => !open)}
            showToggle={databases().length > 0}
            status={
              ctx.response
                ? `${databases().length} table${databases().length === 1 ? '' : 's'}`
                : undefined
            }
          />
        </div>
      </BaseTool>
    );
  },
});

export const describeDatabaseHandler = createToolRenderer({
  name: 'DescribeDatabase',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const schema = () => ctx.response?.data;

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
            Read table{' '}
            <span class="text-ink">
              {schema()?.name ?? ctx.tool.data.databaseId}
            </span>
          </span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((open) => !open)}
            showToggle={!!schema()}
            status={
              schema() ? `${schema()?.tables.length ?? 0} tabs` : undefined
            }
          />
        </div>
      </BaseTool>
    );
  },
});

export const queryDatabaseHandler = createToolRenderer({
  name: 'QueryDatabase',
  render: (ctx) => {
    const [expanded, setExpanded] = createSignal(false);
    const firstResult = () => ctx.response?.data.results[0];

    return (
      <BaseTool
        icon={TerminalIcon}
        renderContext={ctx.renderContext}
        type="call"
        response={
          expanded() && firstResult() ? (
            <ResultTable result={firstResult()!} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span class="min-w-0 truncate font-mono">{ctx.tool.data.sql}</span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((open) => !open)}
            showToggle={!!firstResult()}
            status={ctx.response?.data.summary}
          />
        </div>
      </BaseTool>
    );
  },
});

export const createDatabaseHandler = createToolRenderer({
  name: 'CreateDatabase',
  render: (ctx) => (
    <BaseTool icon={DatabaseIcon} renderContext={ctx.renderContext} type="call">
      <span class="min-w-0 truncate">
        Create table <span class="text-ink">{ctx.tool.data.name}</span>
      </span>
    </BaseTool>
  ),
});

export const createTableHandler = createToolRenderer({
  name: 'CreateTable',
  render: (ctx) => (
    <BaseTool icon={TableIcon} renderContext={ctx.renderContext} type="call">
      <span class="min-w-0 truncate">
        Add tab <span class="text-ink">{ctx.tool.data.name}</span>
      </span>
    </BaseTool>
  ),
});

/**
 * `AddColumn`'s initial select options.
 *
 * Spelled out here because the generated tool schema does not carry the field
 * yet; drop this once `AddColumn` in `generated/tools/types.ts` has `options`.
 */
type AddColumnCallWithOptions = NamedTool<'AddColumn', 'call'>['data'] & {
  options?: string[];
};

export const addColumnHandler = createToolRenderer({
  name: 'AddColumn',
  render: (ctx) => {
    const options = () =>
      (ctx.tool.data as AddColumnCallWithOptions).options ?? [];

    return (
      <BaseTool icon={TableIcon} renderContext={ctx.renderContext} type="call">
        <span class="min-w-0 truncate">
          Add column <span class="text-ink">{ctx.tool.data.name}</span>
          <span class="pl-1.5 text-ink-extra-muted">
            {ctx.tool.data.dataType}
            <Show when={options().length > 0}>
              {' · '}
              {options().join(', ')}
            </Show>
          </span>
        </span>
      </BaseTool>
    );
  },
});
