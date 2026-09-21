import {
  $applyNodeReplacement,
  DecoratorNode,
  type EditorConfig,
  type EditorThemeClasses,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { type DecoratorComponent, getDecorator } from '../decoratorRegistry';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';

export const DATABASE_QUERY_TAG = 'm-db-query';
export type DatabaseQueryDisplayMode =
  | 'scalar'
  | 'table'
  | 'bar'
  | 'line'
  | 'pie';
export type DatabaseQueryChart = { x: string; y: string[]; title?: string };
export type DatabaseQueryData = {
  databaseId?: string;
  tableId?: string;
  sql: string;
  prompt: string;
  title?: string;
  displayMode: DatabaseQueryDisplayMode;
  chart?: DatabaseQueryChart;
};
export type DatabaseQueryDecoratorProps = DatabaseQueryData & {
  key: NodeKey;
  theme: EditorThemeClasses;
};
export type SerializedDatabaseQueryNode = Spread<
  DatabaseQueryData,
  SerializedLexicalNode
>;

/** Only query source is serialized. Results belong to the current viewer. */
export function parseDatabaseQueryData(
  value: unknown
): DatabaseQueryData | undefined {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (
    typeof record.sql !== 'string' ||
    typeof record.prompt !== 'string' ||
    (record.databaseId !== undefined &&
      typeof record.databaseId !== 'string') ||
    (record.tableId !== undefined && typeof record.tableId !== 'string') ||
    (record.title !== undefined && typeof record.title !== 'string') ||
    !['scalar', 'table', 'bar', 'line', 'pie'].includes(
      String(record.displayMode)
    )
  )
    return;
  let chart: DatabaseQueryChart | undefined;
  if (record.chart !== undefined) {
    if (!record.chart || typeof record.chart !== 'object') return;
    const config = record.chart as Record<string, unknown>;
    if (
      typeof config.x !== 'string' ||
      !config.x.trim() ||
      !Array.isArray(config.y) ||
      !config.y.length ||
      config.y.length > 5 ||
      !config.y.every((name) => typeof name === 'string' && name.trim()) ||
      new Set(config.y).size !== config.y.length ||
      config.y.includes(config.x) ||
      (config.title !== undefined && typeof config.title !== 'string')
    )
      return;
    chart = {
      x: config.x,
      y: [...config.y],
      ...(config.title ? { title: config.title as string } : {}),
    };
  }
  return {
    ...(record.databaseId ? { databaseId: record.databaseId as string } : {}),
    ...(record.tableId ? { tableId: record.tableId as string } : {}),
    sql: record.sql,
    prompt: record.prompt,
    ...(record.title ? { title: record.title as string } : {}),
    displayMode: record.displayMode as DatabaseQueryDisplayMode,
    ...(chart ? { chart } : {}),
  };
}

export function databaseQueryMarkdown(data: DatabaseQueryData): string {
  const source = parseDatabaseQueryData(data);
  if (!source) throw new Error('Invalid database query');
  // Escaping '<' prevents user-authored SQL or prompts from closing the XML tag.
  const json = JSON.stringify(source).replaceAll('<', '\\u003c');
  return `<${DATABASE_QUERY_TAG}>${json}</${DATABASE_QUERY_TAG}>`;
}

export class DatabaseQueryNode extends DecoratorNode<
  DecoratorComponent<DatabaseQueryDecoratorProps> | undefined
> {
  __databaseId?: string;
  __tableId?: string;
  __sql: string;
  __prompt: string;
  __title?: string;
  __displayMode: DatabaseQueryDisplayMode;
  __chart?: DatabaseQueryChart;

  static getType() {
    return 'database-query';
  }
  static clone(node: DatabaseQueryNode) {
    return new DatabaseQueryNode(node.exportComponentProps(), node.__key);
  }
  constructor(data: DatabaseQueryData, key?: NodeKey) {
    super(key);
    this.__databaseId = data.databaseId;
    this.__tableId = data.tableId;
    this.__sql = data.sql;
    this.__prompt = data.prompt;
    this.__title = data.title;
    this.__displayMode = data.displayMode;
    this.__chart = data.chart;
  }
  isInline() {
    return this.__displayMode === 'scalar';
  }
  isKeyboardSelectable() {
    return true;
  }
  static importJSON(serialized: SerializedDatabaseQueryNode) {
    const data = parseDatabaseQueryData(serialized);
    if (!data) throw new Error('Invalid database query node');
    const node = $createDatabaseQueryNode(data);
    $applyIdFromSerialized(node, serialized);
    return node;
  }
  exportJSON(): SerializedDatabaseQueryNode {
    return {
      ...super.exportJSON(),
      ...this.exportComponentProps(),
      type: DatabaseQueryNode.getType(),
      version: 1,
    };
  }
  exportComponentProps(): DatabaseQueryData {
    return {
      ...(this.__databaseId ? { databaseId: this.__databaseId } : {}),
      ...(this.__tableId ? { tableId: this.__tableId } : {}),
      sql: this.__sql,
      prompt: this.__prompt,
      ...(this.__title ? { title: this.__title } : {}),
      displayMode: this.__displayMode,
      ...(this.__chart ? { chart: this.__chart } : {}),
    };
  }
  setQuery(data: DatabaseQueryData) {
    const writable = this.getWritable();
    writable.__databaseId = data.databaseId;
    writable.__tableId = data.tableId;
    writable.__sql = data.sql;
    writable.__prompt = data.prompt;
    writable.__title = data.title;
    writable.__displayMode = data.displayMode;
    writable.__chart = data.chart;
  }
  createDOM(): HTMLElement {
    const element = document.createElement(this.isInline() ? 'span' : 'div');
    element.setAttribute('data-database-query', 'true');
    return element;
  }
  updateDOM(previous: DatabaseQueryNode) {
    return previous.__displayMode !== this.__displayMode;
  }
  getTextContent() {
    return this.__title || this.__prompt || 'Database answer';
  }
  exportDOM() {
    const element = this.createDOM();
    element.textContent = this.getTextContent();
    return { element };
  }
  static importDOM() {
    return null;
  }
  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator =
      getDecorator<DatabaseQueryDecoratorProps>(DatabaseQueryNode);
    if (decorator)
      return () =>
        decorator({
          ...this.exportComponentProps(),
          key: this.getKey(),
          theme: config.theme,
        });
  }
}

export function $createDatabaseQueryNode(
  data: DatabaseQueryData
): DatabaseQueryNode {
  return $applyNodeReplacement(new DatabaseQueryNode(data));
}
export function $isDatabaseQueryNode(
  node: LexicalNode | null | undefined
): node is DatabaseQueryNode {
  return node instanceof DatabaseQueryNode;
}
