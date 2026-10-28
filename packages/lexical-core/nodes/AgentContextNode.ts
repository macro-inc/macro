import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMConversionMap,
  type DOMExportOutput,
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

export const AGENT_CONTEXT_NODE_TYPE = 'agent-context';

/** The private context supplied to an agent alongside a channel message. */
export type AgentContextData = {
  version: 1;
  text: string;
};

/** Return whether a value is the supported agent-context payload. */
export function isAgentContextData(value: unknown): value is AgentContextData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return data.version === 1 && typeof data.text === 'string';
}

/** Serialized form of an agent context node. */
export type SerializedAgentContextNode = Spread<
  AgentContextData & { type: typeof AGENT_CONTEXT_NODE_TYPE },
  SerializedLexicalNode
>;

/** Props passed to the application-provided hidden agent context decorator. */
export type AgentContextDecoratorProps = AgentContextData & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

/** Private agent context persisted in internal markdown but hidden from users. */
export class AgentContextNode extends DecoratorNode<
  DecoratorComponent<AgentContextDecoratorProps> | undefined
> {
  __text: string;

  static getType(): typeof AGENT_CONTEXT_NODE_TYPE {
    return AGENT_CONTEXT_NODE_TYPE;
  }

  static clone(node: AgentContextNode): AgentContextNode {
    return new AgentContextNode(node.__text, node.__key);
  }

  constructor(text: string, key?: NodeKey) {
    super(key);
    this.__text = text;
  }

  static importJSON(
    serializedNode: SerializedAgentContextNode
  ): AgentContextNode {
    if (!isAgentContextData(serializedNode)) {
      throw new Error('invalid agent context data');
    }
    const node = $createAgentContextNode(serializedNode);
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedAgentContextNode {
    return {
      ...super.exportJSON(),
      ...this.exportComponentProps(),
      type: AGENT_CONTEXT_NODE_TYPE,
    };
  }

  exportComponentProps(): AgentContextData {
    return { version: 1, text: this.__text };
  }

  getText(): string {
    return this.__text;
  }

  getTextContent(): string {
    return '';
  }

  getSearchText(): string {
    return '';
  }

  isInline(): false {
    return false;
  }

  isKeyboardSelectable(): false {
    return false;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('div');
    element.hidden = true;
    return element;
  }

  updateDOM(): false {
    return false;
  }

  exportDOM(): DOMExportOutput {
    return { element: null };
  }

  static importDOM(): DOMConversionMap | null {
    return null;
  }

  excludeFromCopy(): true {
    return true;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator =
      getDecorator<AgentContextDecoratorProps>(AgentContextNode);
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

/** Create a private agent context node. */
export function $createAgentContextNode(
  data: AgentContextData
): AgentContextNode {
  return $applyNodeReplacement(new AgentContextNode(data.text));
}

/** Return whether a Lexical node is an agent context. */
export function $isAgentContextNode(
  node: LexicalNode | null | undefined
): node is AgentContextNode {
  return node instanceof AgentContextNode;
}
