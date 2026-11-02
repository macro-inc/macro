import {
  $createDatabaseQueryNode,
  $isDatabaseQueryNode,
  type DatabaseQueryNode,
  parseDatabaseQueryJson,
} from '@macro-inc/lexical-core/nodes/DatabaseQueryNode';
import { $isDocumentCardNode } from '@macro-inc/lexical-core/nodes/DocumentCardNode';
import {
  type DatabaseQueryData,
  isDatabaseQueryChartMode,
  parseDatabaseQueryData,
} from '@macro-inc/lexical-core/nodes/databaseQueryData';
import type { LexicalNode } from 'lexical';
import { EditError } from '../editor/errors';
import type { DatabaseQueryView } from '../editor/ops';

function requireChart(data: DatabaseQueryData, label: string): void {
  if (isDatabaseQueryChartMode(data.displayMode) && !data.chart)
    throw new EditError(
      `${label}: a ${data.displayMode} chart needs chart {x, y} naming result columns`
    );
}

/** A saved question's `<m-db-query>` block, as `SaveDatabaseQuery` returns it.
 *  The SQL lives on the server, so anything else is refused, never guessed. */
function parseQueryBlock(query: string): DatabaseQueryData {
  const json = /^<m-db-query>([\s\S]*)<\/m-db-query>$/.exec(query.trim())?.[1];
  const data = json === undefined ? undefined : parseDatabaseQueryJson(json);
  if (!data?.queryId)
    throw new EditError(
      'not a saved <m-db-query>…</m-db-query> block; paste the block from the request verbatim, never write one'
    );
  requireChart(data, '<m-db-query>');
  return data;
}

/** A block answer; a scalar one is wrapped in a paragraph by the caller. */
export function $createQueryBlock(query: string): DatabaseQueryNode {
  return $createDatabaseQueryNode(parseQueryBlock(query));
}

export function $createInlineQuery(query: string): DatabaseQueryNode {
  const data = parseQueryBlock(query);
  if (data.displayMode !== 'scalar')
    throw new EditError(
      `only a scalar answer sits inside text; insert this ${data.displayMode} as a block`
    );
  return $createDatabaseQueryNode(data);
}

/** Change how an answer is shown; `null` removes a field. The question stays. */
export function $setQueryView(
  node: LexicalNode,
  id: string,
  view: DatabaseQueryView
): void {
  if (!$isDatabaseQueryNode(node))
    throw new EditError(`{${id}} is not a database answer`);
  const current = node.exportComponentProps();
  const next: Record<string, unknown> = { ...current };
  for (const [field, value] of Object.entries(view)) {
    if (value === null) delete next[field];
    else if (value !== undefined) next[field] = value;
  }
  const data = parseDatabaseQueryData(next);
  if (!data)
    throw new EditError(
      `{${id}}: invalid view. A chart names 1-5 distinct y result columns other than x, and height is 96-1600.`
    );
  if ((current.displayMode === 'scalar') !== (data.displayMode === 'scalar'))
    throw new EditError(
      `{${id}}: a scalar answer sits inside text, so it cannot switch to or from a table or chart in place; remove it and insert the question's block instead`
    );
  requireChart(data, `{${id}}`);
  node.setQuery(data);
}

/** Point an embedded database card at another table and view. */
export function $setLocation(
  node: LexicalNode,
  id: string,
  tableId: string,
  viewId?: string
): void {
  if (!$isDocumentCardNode(node) || node.getBlockName() !== 'database')
    throw new EditError(`{${id}} is not an embedded database`);
  // An empty view id shows the table's default view, as the card's own picker does.
  node.setBlockParams({ tableId, viewId: viewId ?? '' });
}
