import { $insertNodeToNearestRootAtCaret } from '@lexical/utils';
import {
  $applyNodeReplacement,
  $createParagraphNode,
  $getSiblingCaret,
  $isParagraphNode,
  $isRootOrShadowRoot,
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

const VERSION = 3;

export type AgentSessionMentionInfo = {
  id: string;
  label?: string;
  mentionUuid?: string;
  expanded?: boolean;
};

export type SerializedAgentSessionMentionNode = Spread<
  AgentSessionMentionInfo,
  SerializedLexicalNode
>;

export type AgentSessionMentionDecoratorProps = AgentSessionMentionInfo & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class AgentSessionMentionNode extends DecoratorNode<
  DecoratorComponent<AgentSessionMentionDecoratorProps> | undefined
> {
  __id: string;
  __label: string | undefined;
  __mentionUuid: string | undefined;
  __expanded: boolean;

  __cachedDecoratorSignature?: string;
  __cachedDecoratorComponent?: DecoratorComponent<AgentSessionMentionDecoratorProps>;

  static getType() {
    return 'agent-session-mention';
  }

  isInline(): boolean {
    return !this.__expanded;
  }

  static transform() {
    return (node: LexicalNode) => {
      if (!$isAgentSessionMentionNode(node)) return;
      const parent = node.getParent();
      if (!parent) return;
      if (node.isExpanded() && !$isRootOrShadowRoot(parent)) {
        $insertNodeToNearestRootAtCaret(
          node,
          $getSiblingCaret(node, 'previous')
        );
        // Splitting an otherwise empty paragraph must not add blank lines.
        if ($isParagraphNode(parent)) {
          for (const sibling of [
            node.getPreviousSibling(),
            node.getNextSibling(),
          ]) {
            if ($isParagraphNode(sibling) && sibling.isEmpty())
              sibling.remove();
          }
        }
      } else if (!node.isExpanded() && $isRootOrShadowRoot(parent)) {
        const paragraph = $createParagraphNode();
        node.replace(paragraph);
        paragraph.append(node);
      }
    };
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: AgentSessionMentionNode) {
    const clone = new AgentSessionMentionNode(
      node.__id,
      node.__label,
      node.__mentionUuid,
      node.__key,
      node.__expanded
    );
    clone.__cachedDecoratorSignature = node.__cachedDecoratorSignature;
    clone.__cachedDecoratorComponent = node.__cachedDecoratorComponent;
    return clone;
  }

  constructor(
    id: string,
    label?: string,
    mentionUuid?: string,
    key?: NodeKey,
    expanded = false
  ) {
    super(key);
    this.__id = id;
    this.__label = label;
    this.__mentionUuid = mentionUuid;
    this.__expanded = expanded;
  }

  static importJSON(serializedNode: SerializedAgentSessionMentionNode) {
    const node = $createAgentSessionMentionNode({
      id: serializedNode.id,
      label: serializedNode.label,
      mentionUuid: serializedNode.mentionUuid,
      expanded: serializedNode.expanded,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedAgentSessionMentionNode {
    return {
      ...super.exportJSON(),
      id: this.__id,
      label: this.__label,
      mentionUuid: this.__mentionUuid,
      ...(this.__expanded ? { expanded: true } : {}),
      type: AgentSessionMentionNode.getType(),
      version: VERSION,
    };
  }

  exportComponentProps(): AgentSessionMentionInfo {
    return {
      id: this.__id,
      label: this.__label,
      mentionUuid: this.__mentionUuid,
      ...(this.__expanded ? { expanded: true } : {}),
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement(this.__expanded ? 'div' : 'span');
    span.setAttribute('data-agent-session-mention', 'true');
    return span;
  }

  updateDOM(prevNode: AgentSessionMentionNode, _dom: HTMLElement): boolean {
    return prevNode.__expanded !== this.__expanded;
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    const convert = (domNode: HTMLElement) => {
      const id = domNode.getAttribute('data-agent-session-id');
      const label =
        domNode.getAttribute('data-agent-session-label') || undefined;
      const mentionUuid =
        domNode.getAttribute('data-mention-uuid') || undefined;

      if (id) {
        return {
          node: $createAgentSessionMentionNode({
            id,
            label,
            mentionUuid,
            expanded:
              domNode.getAttribute('data-agent-session-expanded') === 'true',
          }),
        };
      }

      return null;
    };

    const wrapInCheck = (conversion: DOMConversion) => {
      return (node: HTMLElement) =>
        node.hasAttribute('data-agent-session-mention') ? conversion : null;
    };

    return {
      div: wrapInCheck({ conversion: convert, priority: 1 }),
      span: wrapInCheck({ conversion: convert, priority: 1 }),
      a: wrapInCheck({ conversion: convert, priority: 1 }),
    };
  }

  getDataAttrs(): Record<string, string> {
    return {
      'data-agent-session-mention': 'true',
      'data-agent-session-id': this.__id,
      'data-agent-session-label': this.__label || '',
      'data-mention-uuid': this.__mentionUuid || '',
      ...(this.__expanded ? { 'data-agent-session-expanded': 'true' } : {}),
    };
  }

  exportDOM() {
    const element = document.createElement(this.__expanded ? 'div' : 'span');
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
    return this.__label || 'Agent session';
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
    self.__cachedDecoratorComponent = undefined;
  }

  isExpanded(): boolean {
    return this.__expanded;
  }

  setExpanded(expanded: boolean) {
    const self = this.getWritable();
    self.__expanded = expanded;
    self.__cachedDecoratorComponent = undefined;
  }

  getMentionUuid(): string | undefined {
    return this.__mentionUuid;
  }

  setMentionUuid(mentionUuid: string | undefined) {
    const self = this.getWritable();
    self.__mentionUuid = mentionUuid;
    self.__cachedDecoratorComponent = undefined;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const signature = JSON.stringify(this.exportComponentProps());
    if (
      this.__cachedDecoratorComponent &&
      this.__cachedDecoratorSignature === signature
    )
      return this.__cachedDecoratorComponent;
    this.__cachedDecoratorSignature = signature;
    const Component = getDecorator<AgentSessionMentionDecoratorProps>(
      AgentSessionMentionNode
    );

    if (!Component) return undefined;

    this.__cachedDecoratorComponent = () =>
      Component({
        ...this.exportComponentProps(),
        key: this.getKey(),
        theme: config.theme,
      });
    return this.__cachedDecoratorComponent;
  }
}

export function buildAgentSessionMentionMarkdown(
  info: AgentSessionMentionInfo
): string {
  const json = JSON.stringify(info).replace(/</g, '\\u003c');
  return `<m-agent-session-mention>${json}</m-agent-session-mention>`;
}

export function $createAgentSessionMentionNode(
  params: AgentSessionMentionInfo
) {
  const node = new AgentSessionMentionNode(
    params.id,
    params.label,
    params.mentionUuid,
    undefined,
    params.expanded
  );
  return $applyNodeReplacement(node);
}

export function $isAgentSessionMentionNode(
  node: AgentSessionMentionNode | LexicalNode | null | undefined
): node is AgentSessionMentionNode {
  return node instanceof AgentSessionMentionNode;
}
