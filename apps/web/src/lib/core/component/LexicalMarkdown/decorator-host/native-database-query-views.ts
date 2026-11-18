import {
  type DatabaseQueryDecoratorProps,
  DatabaseQueryNode,
} from '@macro-inc/lexical-core/nodes/DatabaseQueryNode';
import {
  type DatabaseQueryChart,
  isDatabaseQueryDisplayMode,
} from '@macro-inc/lexical-core/nodes/databaseQueryData';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type {
  JsonObject,
  JsonValue,
} from '@macro-inc/lexical-wasm-view/view/types';
import type { DecoratorHostCapabilities } from '../context/DecoratorHostContext';
import type {
  DatabaseQueryHost,
  DatabaseQueryHostProp,
} from './database-query-host';
import {
  createNativeDecoratorAdapter,
  type NativeDecoratorContext,
} from './native-adapter';

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function optionalString(value: JsonValue | undefined): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string')
    throw new Error('Invalid database query payload');
  return value;
}
function isChart(
  value: JsonValue | undefined
): value is JsonObject & DatabaseQueryChart {
  return (
    isObject(value) &&
    typeof value.x === 'string' &&
    Array.isArray(value.y) &&
    value.y.every((y) => typeof y === 'string') &&
    (value.title == null || typeof value.title === 'string') &&
    (value.color == null || typeof value.color === 'string') &&
    (value.stack == null || typeof value.stack === 'boolean')
  );
}

/** Project the native payload like Source DatabaseQueryNode.exportComponentProps. */
export function createNativeDatabaseQueryViews<
  Host extends DecoratorHostCapabilities & DatabaseQueryHost,
>(
  context: NativeDecoratorContext<Host>
): Pick<MacroDecorators, 'database-query'> {
  const bind = createNativeDecoratorAdapter(context);
  return {
    'database-query': bind<DatabaseQueryDecoratorProps & DatabaseQueryHostProp>(
      DatabaseQueryNode,
      (node, context) => {
        const value = node.props();
        if (
          typeof value.queryId !== 'string' ||
          typeof value.prompt !== 'string' ||
          !isDatabaseQueryDisplayMode(value.displayMode) ||
          (value.height != null && typeof value.height !== 'number')
        )
          throw new Error('Invalid database query payload');
        const databaseId = optionalString(value.databaseId);
        const tableId = optionalString(value.tableId);
        const title = optionalString(value.title);
        const stored = value.chart;
        if (stored != null && !isChart(stored))
          throw new Error('Invalid database query chart');
        return {
          queryId: value.queryId,
          ...(databaseId ? { databaseId } : {}),
          ...(tableId ? { tableId } : {}),
          ...(title ? { title } : {}),
          prompt: value.prompt,
          displayMode: value.displayMode,
          // Source passes the stored chart object unchanged.
          ...(stored != null && isChart(stored) ? { chart: stored } : {}),
          ...(typeof value.height === 'number' ? { height: value.height } : {}),
          key: String(node.key),
          theme: context.theme,
          host: context.host,
        };
      }
    ),
  };
}
