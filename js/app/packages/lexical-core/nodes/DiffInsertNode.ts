import {
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

export type DiffInsertInfo = {
  markdown: string;
};

export type SerializedDiffInsertNode = Spread<
  {
    markdown: string;
  },
  SerializedLexicalNode
>;

export type DiffInsertDecoratorProps = {
  markdown: string;
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class DiffInsertNode extends DecoratorNode<
  DecoratorComponent<DiffInsertDecoratorProps> | undefined
> {
  __markdown: string;

  static getType() {
    return 'diff-insert';
  }

  static clone(node: DiffInsertNode) {
    return new DiffInsertNode(node.__markdown, node.__key);
  }

  constructor(markdown: string, key?: NodeKey) {
    super(key);
    this.__markdown = markdown;
  }

  isIsolated(): boolean {
    return true;
  }

  isInline(): boolean {
    return false;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  createDOM() {
    const div = document.createElement('div');
    return div;
  }

  updateDOM() {
    return false;
  }

  static importJSON(serialized: SerializedDiffInsertNode): DiffInsertNode {
    const diffInsertNode = new DiffInsertNode(serialized.markdown);
    $applyIdFromSerialized(diffInsertNode, serialized);
    return diffInsertNode;
  }

  exportJSON(): SerializedDiffInsertNode {
    return {
      ...super.exportJSON(),
      markdown: this.__markdown,
      type: DiffInsertNode.getType(),
      version: 1,
    };
  }

  exportComponentProps(): DiffInsertInfo {
    return {
      markdown: this.__markdown,
    };
  }

  getMarkdown() {
    return this.__markdown;
  }

  setMarkdown(markdown: string) {
    const writable = this.getWritable();
    writable.__markdown = markdown;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<DiffInsertNode>(DiffInsertNode);
    if (decorator) {
      return () =>
        decorator({
          markdown: this.__markdown,
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createDiffInsertNode(markdown: string): DiffInsertNode {
  return new DiffInsertNode(markdown);
}

export function $isDiffInsertNode(
  node: LexicalNode | null
): node is DiffInsertNode {
  return node instanceof DiffInsertNode;
}
