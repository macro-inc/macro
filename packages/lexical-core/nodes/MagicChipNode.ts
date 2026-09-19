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

const VERSION = 4;

export const MAGIC_CHIP_NODE_TYPE = 'magic-chip';

/** Agent-session states supported by the static Magic Chip. */
export const MAGIC_CHIP_STATUSES = [
  'no_messages',
  'booting',
  'acp_ready',
  'shutting_down',
  'disconnected',
] as const;

/** Agent-session state displayed by the static Magic Chip. */
export type MagicChipStatus = (typeof MAGIC_CHIP_STATUSES)[number];

/** Which side of an agent turn a folded message belongs to. */
export const MAGIC_CHIP_AUTHORS = ['user', 'agent'] as const;

/** Which side of an agent turn a folded message belongs to. */
export type MagicChipAuthor = (typeof MAGIC_CHIP_AUTHORS)[number];

/**
 * The folded agent-session message a chip anchors.
 */
export type MagicChipMessage = {
  turn: number;
  author: MagicChipAuthor;
};

/** Persisted identity and status for a static Magic Chip. */
export type MagicChipData = {
  agentSessionId: string;
  channelId?: string;
  promptedMessage: MagicChipMessage;
  status: MagicChipStatus;
};

/** Serialized form of a Magic Chip node. */
export type SerializedMagicChipNode = Spread<
  MagicChipData,
  SerializedLexicalNode
>;

/** Props passed to the application-provided Magic Chip decorator. */
export type MagicChipDecoratorProps = MagicChipData & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

/** Return whether a value is a supported Magic Chip author. */
export function isMagicChipAuthor(value: unknown): value is MagicChipAuthor {
  return (MAGIC_CHIP_AUTHORS as readonly unknown[]).includes(value);
}

/** Return whether a value identifies a folded message a chip can anchor. */
export function isMagicChipMessage(value: unknown): value is MagicChipMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<MagicChipMessage>;
  return (
    typeof message.turn === 'number' &&
    Number.isInteger(message.turn) &&
    message.turn >= 0 &&
    isMagicChipAuthor(message.author)
  );
}

/** Return whether a value is a supported static Magic Chip status. */
export function isMagicChipStatus(value: unknown): value is MagicChipStatus {
  return (MAGIC_CHIP_STATUSES as readonly unknown[]).includes(value);
}

/** A static agent-session status reference embedded in channel markdown. */
export class MagicChipNode extends DecoratorNode<
  DecoratorComponent<MagicChipDecoratorProps> | undefined
> {
  __agentSessionId: string;
  __channelId?: string;
  __promptedMessage: MagicChipMessage;
  __status: MagicChipStatus;

  static getType() {
    return MAGIC_CHIP_NODE_TYPE;
  }

  static clone(node: MagicChipNode) {
    return new MagicChipNode(
      node.__agentSessionId,
      node.__channelId,
      node.__promptedMessage,
      node.__status,
      node.__key
    );
  }

  constructor(
    agentSessionId: string,
    channelId: string | undefined,
    promptedMessage: MagicChipMessage,
    status: MagicChipStatus,
    key?: NodeKey
  ) {
    super(key);
    this.__agentSessionId = agentSessionId;
    this.__channelId = channelId;
    this.__promptedMessage = promptedMessage;
    this.__status = status;
  }

  isInline(): boolean {
    return false;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static importJSON(serializedNode: SerializedMagicChipNode) {
    const node = $createMagicChipNode(serializedNode);
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedMagicChipNode {
    return {
      ...super.exportJSON(),
      ...this.exportComponentProps(),
      type: MAGIC_CHIP_NODE_TYPE,
      version: VERSION,
    };
  }

  exportComponentProps(): MagicChipData {
    return {
      agentSessionId: this.__agentSessionId,
      ...(this.__channelId === undefined
        ? {}
        : { channelId: this.__channelId }),
      promptedMessage: this.__promptedMessage,
      status: this.__status,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('div');
    element.setAttribute('data-magic-chip', this.__agentSessionId);
    return element;
  }

  updateDOM(): boolean {
    return false;
  }

  exportDOM() {
    const element = document.createElement('div');
    element.setAttribute('data-magic-chip', this.__agentSessionId);
    element.textContent = this.__status;
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return null;
  }

  getTextContent(): string {
    return this.__status;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<MagicChipDecoratorProps>(MagicChipNode);
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

/** Create a static Magic Chip node. */
export function $createMagicChipNode(data: MagicChipData): MagicChipNode {
  return $applyNodeReplacement(
    new MagicChipNode(
      data.agentSessionId,
      data.channelId,
      data.promptedMessage,
      data.status
    )
  );
}

/** Return whether a Lexical node is a Magic Chip. */
export function $isMagicChipNode(
  node: LexicalNode | null | undefined
): node is MagicChipNode {
  return node instanceof MagicChipNode;
}
