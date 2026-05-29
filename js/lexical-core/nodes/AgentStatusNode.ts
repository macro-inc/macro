import {
  $applyNodeReplacement,
  DecoratorNode,
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

export type AgentStatusInfo = {
  /** Status text shown with a pulsing animation (e.g. "Macro Agent is thinking"). */
  statusText: string;
};

export type SerializedAgentStatusNode = Spread<
  AgentStatusInfo,
  SerializedLexicalNode
>;

export type AgentStatusDecoratorProps = {
  statusText: string;
  key: NodeKey;
  theme: EditorThemeClasses;
};

/**
 * An inline, non-selectable node that renders text with a pulsing animation —
 * used for an agent's transient "working" status (e.g. Macro Agent's initial
 * "thinking" message before it edits in the answer).
 */
export class AgentStatusNode extends DecoratorNode<
  DecoratorComponent<AgentStatusDecoratorProps> | undefined
> {
  __statusText: string;

  static getType() {
    return 'agent-status';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return false;
  }

  static clone(node: AgentStatusNode) {
    return new AgentStatusNode(node.__statusText, node.__key);
  }

  constructor(statusText: string, key?: NodeKey) {
    super(key);
    this.__statusText = statusText;
  }

  static importJSON(serializedNode: SerializedAgentStatusNode) {
    const node = $createAgentStatusNode({
      statusText: serializedNode.statusText,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedAgentStatusNode {
    return {
      ...super.exportJSON(),
      statusText: this.__statusText,
      type: AgentStatusNode.getType(),
      version: 1,
    };
  }

  exportComponentProps(): AgentStatusInfo {
    return {
      statusText: this.__statusText,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    return document.createElement('span');
  }

  updateDOM(): boolean {
    return false;
  }

  getDataAttrs(): Record<string, string | boolean> {
    return {
      'data-agent-status': true,
      'data-status-text': this.__statusText,
    };
  }

  static importDOM(): DOMConversionMap<HTMLSpanElement> | null {
    return {
      span: (domNode: HTMLSpanElement) => {
        if (!domNode.hasAttribute('data-agent-status')) {
          return null;
        }
        return {
          conversion: (element: HTMLElement) => {
            const statusText = element.getAttribute('data-status-text');
            if (statusText) {
              return { node: $createAgentStatusNode({ statusText }) };
            }
            return null;
          },
          priority: 1,
        };
      },
    };
  }

  exportDOM() {
    const element = document.createElement('span');
    for (const [k, v] of Object.entries(this.getDataAttrs())) {
      element.setAttribute(k, v.toString());
    }
    element.textContent = this.__statusText;
    return { element };
  }

  getTextContent(): string {
    return this.__statusText;
  }

  getStatusText(): string {
    return this.__statusText;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<AgentStatusDecoratorProps>(AgentStatusNode);
    if (decorator) {
      return () =>
        decorator({
          ...this.exportComponentProps(),
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createAgentStatusNode(params: { statusText: string }) {
  const node = new AgentStatusNode(params.statusText);
  return $applyNodeReplacement(node);
}

export function $isAgentStatusNode(
  node: AgentStatusNode | LexicalNode | null | undefined
): node is AgentStatusNode {
  return node instanceof AgentStatusNode;
}
