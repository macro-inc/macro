import {
  $applyNodeReplacement,
  $createParagraphNode,
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
import {
  type DatabaseQueryChart,
  type DatabaseQueryData,
  type DatabaseQueryDisplayMode,
  parseDatabaseQueryData,
} from './databaseQueryData';
import { $createUnknownMentionNode } from './UnknownMentionNode';

const DATABASE_QUERY_TAG = 'm-db-query';

export type DatabaseQueryDecoratorProps = DatabaseQueryData & {
  key: NodeKey;
  theme: EditorThemeClasses;
};
export type SerializedDatabaseQueryNode = Spread<
  DatabaseQueryData,
  SerializedLexicalNode
>;

/** An `<m-db-query>` tag's payload; `undefined` when malformed. */
export function parseDatabaseQueryJson(
  json: string
): DatabaseQueryData | undefined {
  try {
    return parseDatabaseQueryData(JSON.parse(json));
  } catch {
    return;
  }
}

export function databaseQueryMarkdown(data: DatabaseQueryData): string {
  const source = parseDatabaseQueryData(data);
  if (!source) throw new Error('Invalid database query');
  // Escaping '<' prevents user-authored titles or prompts from closing the XML tag.
  const json = JSON.stringify(source).replaceAll('<', '\\u003c');
  return `<${DATABASE_QUERY_TAG}>${json}</${DATABASE_QUERY_TAG}>`;
}

export class DatabaseQueryNode extends DecoratorNode<
  DecoratorComponent<DatabaseQueryDecoratorProps> | undefined
> {
  __queryId: string;
  __databaseId?: string;
  __tableId?: string;
  __prompt: string;
  __title?: string;
  __displayMode: DatabaseQueryDisplayMode;
  __chart?: DatabaseQueryChart;
  __height?: number;

  static getType() {
    return 'database-query';
  }
  static clone(node: DatabaseQueryNode) {
    return new DatabaseQueryNode(node.exportComponentProps(), node.__key);
  }
  constructor(data: DatabaseQueryData, key?: NodeKey) {
    super(key);
    this.__queryId = data.queryId;
    this.__databaseId = data.databaseId;
    this.__tableId = data.tableId;
    this.__prompt = data.prompt;
    this.__title = data.title;
    this.__displayMode = data.displayMode;
    this.__chart = data.chart;
    this.__height = data.height;
  }
  isInline() {
    return this.__displayMode === 'scalar';
  }
  isKeyboardSelectable() {
    return true;
  }
  static importJSON(serialized: SerializedDatabaseQueryNode): LexicalNode {
    const data = parseDatabaseQueryData(serialized);
    // An unreadable answer degrades like its markdown form instead of failing the document.
    if (!data) {
      const fallback = $createUnknownMentionNode({
        name: 'Unavailable database question',
      });
      return serialized.displayMode === 'scalar'
        ? fallback
        : $createParagraphNode().append(fallback);
    }
    const node = $createDatabaseQueryNode(data);
    $applyIdFromSerialized(node, serialized);
    return node;
  }
  exportJSON(): SerializedDatabaseQueryNode {
    return {
      ...super.exportJSON(),
      ...this.exportComponentProps(),
      type: DatabaseQueryNode.getType(),
      version: 2,
    };
  }
  exportComponentProps(): DatabaseQueryData {
    return {
      queryId: this.__queryId,
      ...(this.__databaseId ? { databaseId: this.__databaseId } : {}),
      ...(this.__tableId ? { tableId: this.__tableId } : {}),
      ...(this.__title ? { title: this.__title } : {}),
      prompt: this.__prompt,
      displayMode: this.__displayMode,
      ...(this.__chart ? { chart: this.__chart } : {}),
      ...(this.__height !== undefined ? { height: this.__height } : {}),
    };
  }
  setQuery(data: DatabaseQueryData) {
    const writable = this.getWritable();
    writable.__queryId = data.queryId;
    writable.__databaseId = data.databaseId;
    writable.__tableId = data.tableId;
    writable.__prompt = data.prompt;
    writable.__title = data.title;
    writable.__displayMode = data.displayMode;
    writable.__chart = data.chart;
    writable.__height = data.height;
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
