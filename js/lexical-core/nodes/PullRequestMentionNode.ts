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

export type PullRequestMentionInfo = {
  id: string;
  label?: string;
  mentionUuid?: string;
};

export type SerializedPullRequestMentionNode = Spread<
  PullRequestMentionInfo,
  SerializedLexicalNode
>;

export type PullRequestMentionDecoratorProps = PullRequestMentionInfo & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class PullRequestMentionNode extends DecoratorNode<
  DecoratorComponent<PullRequestMentionDecoratorProps> | undefined
> {
  __id: string;
  __label: string | undefined;
  __mentionUuid: string | undefined;

  static getType() {
    return 'pr-mention';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: PullRequestMentionNode) {
    return new PullRequestMentionNode(
      node.__id,
      node.__label,
      node.__mentionUuid,
      node.__key
    );
  }

  constructor(id: string, label?: string, mentionUuid?: string, key?: NodeKey) {
    super(key);
    this.__id = id;
    this.__label = label;
    this.__mentionUuid = mentionUuid;
  }

  static importJSON(serializedNode: SerializedPullRequestMentionNode) {
    const node = $createPullRequestMentionNode({
      id: serializedNode.id,
      label: serializedNode.label,
      mentionUuid: serializedNode.mentionUuid,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedPullRequestMentionNode {
    return {
      ...super.exportJSON(),
      id: this.__id,
      label: this.__label,
      mentionUuid: this.__mentionUuid,
      type: PullRequestMentionNode.getType(),
      version: VERSION,
    };
  }

  exportComponentProps(): PullRequestMentionInfo {
    return {
      id: this.__id,
      label: this.__label,
      mentionUuid: this.__mentionUuid,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.setAttribute('data-pr-mention', 'true');
    return span;
  }

  updateDOM(_prevNode: PullRequestMentionNode, _dom: HTMLElement): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    const convert = (domNode: HTMLElement) => {
      const id = domNode.getAttribute('data-pr-id');
      const label = domNode.getAttribute('data-pr-label') || undefined;
      const mentionUuid =
        domNode.getAttribute('data-mention-uuid') || undefined;

      if (id) {
        return {
          node: $createPullRequestMentionNode({ id, label, mentionUuid }),
        };
      }

      return null;
    };

    const wrapInCheck = (conversion: DOMConversion) => {
      return (node: HTMLElement) =>
        node.hasAttribute('data-pr-mention') ? conversion : null;
    };

    return {
      span: wrapInCheck({ conversion: convert, priority: 1 }),
      a: wrapInCheck({ conversion: convert, priority: 1 }),
    };
  }

  getDataAttrs(): Record<string, string> {
    return {
      'data-pr-mention': 'true',
      'data-pr-id': this.__id,
      'data-pr-label': this.__label || '',
      'data-mention-uuid': this.__mentionUuid || '',
    };
  }

  exportDOM() {
    const element = document.createElement('span');
    const attrs = this.getDataAttrs();
    for (const [k, v] of Object.entries(attrs)) {
      if (v) {
        element.setAttribute(k, v);
      }
    }
    element.textContent = this.getTextContent();
    return { element };
  }

  getTextContent(): string {
    return this.__label || 'Pull request';
  }

  getSearchText(): string {
    return this.getTextContent();
  }

  getId(): string {
    return this.__id;
  }

  getLabel(): string | undefined {
    return this.__label;
  }

  setLabel(label: string | undefined) {
    const self = this.getWritable();
    self.__label = label;
  }

  getMentionUuid(): string | undefined {
    return this.__mentionUuid;
  }

  setMentionUuid(mentionUuid: string | undefined) {
    const self = this.getWritable();
    self.__mentionUuid = mentionUuid;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const Component = getDecorator<PullRequestMentionDecoratorProps>(
      PullRequestMentionNode
    );

    if (!Component) return undefined;

    return () =>
      Component({
        ...this.exportComponentProps(),
        key: this.getKey(),
        theme: config.theme,
      });
  }
}

export function $createPullRequestMentionNode(params: PullRequestMentionInfo) {
  const node = new PullRequestMentionNode(
    params.id,
    params.label,
    params.mentionUuid
  );
  return $applyNodeReplacement(node);
}

export function $isPullRequestMentionNode(
  node: PullRequestMentionNode | LexicalNode | null | undefined
): node is PullRequestMentionNode {
  return node instanceof PullRequestMentionNode;
}
