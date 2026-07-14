import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMConversion,
  type DOMConversionMap,
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

const VERSION = 1;

export type ThemeMentionInfo = {
  name: string;
  data: Record<string, unknown>;
};

export type SerializedThemeMentionNode = Spread<
  ThemeMentionInfo,
  SerializedLexicalNode
>;

export type ThemeMentionDecoratorProps = ThemeMentionInfo & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class ThemeMentionNode extends DecoratorNode<
  DecoratorComponent<ThemeMentionDecoratorProps> | undefined
> {
  __name: string;
  __data: Record<string, unknown>;

  static getType() {
    return 'theme-mention';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: ThemeMentionNode) {
    return new ThemeMentionNode(node.__name, node.__data, node.__key);
  }

  constructor(name: string, data: Record<string, unknown>, key?: NodeKey) {
    super(key);
    this.__name = name;
    this.__data = data;
  }

  static importJSON(serializedNode: SerializedThemeMentionNode) {
    const node = $createThemeMentionNode(
      serializedNode.name,
      serializedNode.data
    );
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedThemeMentionNode {
    return {
      ...super.exportJSON(),
      name: this.__name,
      data: this.__data,
      type: ThemeMentionNode.getType(),
      version: VERSION,
    };
  }

  exportComponentProps(): ThemeMentionInfo {
    return {
      name: this.__name,
      data: this.__data,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.setAttribute('data-theme-mention', 'true');
    return span;
  }

  updateDOM(_prevNode: ThemeMentionNode, _dom: HTMLElement): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    const convert = (domNode: HTMLElement) => {
      const themeJson = domNode.getAttribute('data-theme-json');
      if (!themeJson) return null;

      try {
        const parsed: unknown = JSON.parse(themeJson);
        if (typeof parsed !== 'object' || parsed === null) return null;
        const obj = parsed as Record<string, unknown>;
        if (typeof obj.name !== 'string') return null;

        const node = $createThemeMentionNode(
          obj.name,
          obj as Record<string, unknown>
        );
        return { node };
      } catch {
        return null;
      }
    };

    const wrapInCheck = (conversion: DOMConversion) => {
      return (node: HTMLElement) =>
        node.hasAttribute('data-theme-mention') ? conversion : null;
    };

    return {
      span: wrapInCheck({ conversion: convert, priority: 1 }),
    };
  }

  exportDOM() {
    const element = document.createElement('span');
    element.setAttribute('data-theme-mention', 'true');
    element.setAttribute('data-theme-json', JSON.stringify(this.__data));
    element.textContent = this.__name;
    return { element };
  }

  getTextContent(): string {
    return this.__name;
  }

  getThemeName(): string {
    return this.__name;
  }

  getThemeData(): Record<string, unknown> {
    return this.__data;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator =
      getDecorator<ThemeMentionDecoratorProps>(ThemeMentionNode);
    if (decorator) {
      return () =>
        decorator({
          name: this.__name,
          data: this.__data,
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createThemeMentionNode(
  name: string,
  data: Record<string, unknown>
): ThemeMentionNode {
  const node = new ThemeMentionNode(name, data);
  return $applyNodeReplacement(node);
}

export function $isThemeMentionNode(
  node: ThemeMentionNode | LexicalNode | null | undefined
): node is ThemeMentionNode {
  return node instanceof ThemeMentionNode;
}
