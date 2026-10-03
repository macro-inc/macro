/**
 * Database tool renderers, loaded on first use so the chat bundle never
 * carries the databases UI or SQL engine; inert while databases are off.
 */
import { enableDatabases, isFeatureEnabled } from '@core/constant/featureFlags';
import type { ToolName } from '@service-cognition/generated/tools/tool';
import { lazy, Suspense } from 'solid-js';
import type {
  RenderContext,
  ToolHandler,
  ToolHandlerMap,
} from './ToolRenderer';

const DATABASE_TOOL_NAMES = [
  'ListDatabases',
  'DescribeDatabase',
  'QueryDatabase',
  'SaveDatabaseView',
  'DeleteDatabaseView',
  'SaveDatabaseQuery',
] as const satisfies readonly ToolName[];

type DatabaseToolName = (typeof DATABASE_TOOL_NAMES)[number];

export type DatabaseToolHandlerMap = Pick<
  ToolHandlerMap<RenderContext>,
  DatabaseToolName
>;

function isDatabaseToolName(name: string): name is DatabaseToolName {
  return (DATABASE_TOOL_NAMES as readonly string[]).includes(name);
}

/** Every tool renders, except a database tool while databases are off. */
export function isToolShown(name: string, databasesEnabled: boolean): boolean {
  return databasesEnabled || !isDatabaseToolName(name);
}

export function DatabaseToolPlaceholder() {
  return <span class="text-xs text-ink-muted">Database tool</span>;
}

async function loadDatabaseToolHandlers(): Promise<DatabaseToolHandlerMap> {
  const module = await import('./DatabaseTools');
  return module.databaseToolHandlers;
}

function lazyDatabaseToolHandler<Name extends DatabaseToolName>(
  name: Name
): ToolHandler<Name, RenderContext> {
  const Render = lazy(async () => {
    const handlers = await loadDatabaseToolHandlers();
    return { default: handlers[name].render };
  });
  return {
    render: (props) => (
      <Suspense fallback={<DatabaseToolPlaceholder />}>
        <Render {...props} />
      </Suspense>
    ),
    handleCall: async (context) => {
      if (!isFeatureEnabled(enableDatabases)) return;
      const handlers = await loadDatabaseToolHandlers();
      await handlers[name].handleCall?.(context);
    },
    handleResponse: async (context) => {
      if (!isFeatureEnabled(enableDatabases)) return;
      const handlers = await loadDatabaseToolHandlers();
      await handlers[name].handleResponse?.(context);
    },
  };
}

export const lazyDatabaseToolHandlers = Object.fromEntries(
  DATABASE_TOOL_NAMES.map((name) => [name, lazyDatabaseToolHandler(name)])
) as DatabaseToolHandlerMap;
