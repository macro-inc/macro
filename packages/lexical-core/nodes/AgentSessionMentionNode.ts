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

const VERSION = 2;

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

  static getType() {
    return 'agent-session-mention';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: AgentSessionMentionNode) {
    return new AgentSessionMentionNode(
      node.__id,
      node.__label,
      node.__mentionUuid,
      node.__key,
      node.__expanded
    );
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
    const span = document.createElement('span');
    span.setAttribute('data-agent-session-mention', 'true');
    return span;
  }

  updateDOM(_prevNode: AgentSessionMentionNode, _dom: HTMLElement): boolean {
    return false;
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
  }

  isExpanded(): boolean {
    return this.__expanded;
  }

  setExpanded(expanded: boolean) {
    this.getWritable().__expanded = expanded;
  }

  getMentionUuid(): string | undefined {
    return this.__mentionUuid;
  }

  setMentionUuid(mentionUuid: string | undefined) {
    const self = this.getWritable();
    self.__mentionUuid = mentionUuid;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const Component = getDecorator<AgentSessionMentionDecoratorProps>(
      AgentSessionMentionNode
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
