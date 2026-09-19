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

const VERSION = 1;

export const REPLY_TARGET_NODE_TYPE = 'reply-target';
export const REPLY_TARGET_NODE_TAG = 'm-reply-target';

/** The message reference and preview persisted by a reply-target node. */
export type ReplyTargetData = {
  channelId: string;
  targetMessageId: string;
  targetThreadId: string;
  displayText: string;
  senderId: string;
};

/** Return whether a value is a valid reply-target-node payload. */
export function isReplyTargetData(value: unknown): value is ReplyTargetData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.channelId === 'string' &&
    typeof data.targetMessageId === 'string' &&
    typeof data.targetThreadId === 'string' &&
    typeof data.displayText === 'string' &&
    typeof data.senderId === 'string'
  );
}

/** Serialize reply-target data into the internal Markdown representation. */
export function buildReplyTargetMarkdown(data: ReplyTargetData): string {
  const payload = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<${REPLY_TARGET_NODE_TAG}>${payload}</${REPLY_TARGET_NODE_TAG}>`;
}

/** Remove one leading reply-target block from internal Markdown. */
export function stripLeadingReplyTargetMarkdown(markdown: string): string {
  const pattern = new RegExp(
    `^\\s*<${REPLY_TARGET_NODE_TAG}>.*?<\\/${REPLY_TARGET_NODE_TAG}>\\s*`,
    's'
  );
  return markdown.replace(pattern, '');
}

/** Serialized form of a reply-target node. */
export type SerializedReplyTargetNode = Spread<
  ReplyTargetData,
  SerializedLexicalNode
>;

/** Props passed to the application-provided reply-target decorator. */
export type ReplyTargetDecoratorProps = ReplyTargetData & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

/** A block-level reference to another message in a channel thread. */
export class ReplyTargetNode extends DecoratorNode<
  DecoratorComponent<ReplyTargetDecoratorProps> | undefined
> {
  __channelId: string;
  __targetMessageId: string;
  __targetThreadId: string;
  __displayText: string;
  __senderId: string;

  static getType(): typeof REPLY_TARGET_NODE_TYPE {
    return REPLY_TARGET_NODE_TYPE;
  }

  static clone(node: ReplyTargetNode): ReplyTargetNode {
    return new ReplyTargetNode(
      node.__channelId,
      node.__targetMessageId,
      node.__targetThreadId,
      node.__displayText,
      node.__senderId,
      node.__key
    );
  }

  constructor(
    channelId: string,
    targetMessageId: string,
    targetThreadId: string,
    displayText: string,
    senderId: string,
    key?: NodeKey
  ) {
    super(key);
    this.__channelId = channelId;
    this.__targetMessageId = targetMessageId;
    this.__targetThreadId = targetThreadId;
    this.__displayText = displayText;
    this.__senderId = senderId;
  }

  static importJSON(
    serializedNode: SerializedReplyTargetNode
  ): ReplyTargetNode {
    if (!isReplyTargetData(serializedNode)) {
      throw new Error('invalid reply-target data');
    }
    const node = $createReplyTargetNode(serializedNode);
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedReplyTargetNode {
    return {
      ...super.exportJSON(),
      ...this.exportComponentProps(),
      type: REPLY_TARGET_NODE_TYPE,
      version: VERSION,
    };
  }

  exportComponentProps(): ReplyTargetData {
    return {
      channelId: this.__channelId,
      targetMessageId: this.__targetMessageId,
      targetThreadId: this.__targetThreadId,
      displayText: this.__displayText,
      senderId: this.__senderId,
    };
  }

  isInline(): false {
    return false;
  }

  isKeyboardSelectable(): true {
    return true;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('div');
    element.setAttribute('data-reply-target-node', this.__targetMessageId);
    return element;
  }

  updateDOM(): false {
    return false;
  }

  exportDOM() {
    const element = document.createElement('div');
    element.setAttribute('data-reply-target-node', this.__targetMessageId);
    element.textContent = this.__displayText;
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return null;
  }

  getTextContent(): string {
    return this.__displayText;
  }

  getSearchText(): string {
    return this.__displayText;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<ReplyTargetDecoratorProps>(ReplyTargetNode);
    if (!decorator) return;
    return () =>
      decorator({
        ...this.exportComponentProps(),
        key: this.getKey(),
        theme: config.theme,
      });
  }
}

/** Create a block-level channel reply-target reference. */
export function $createReplyTargetNode(data: ReplyTargetData): ReplyTargetNode {
  return $applyNodeReplacement(
    new ReplyTargetNode(
      data.channelId,
      data.targetMessageId,
      data.targetThreadId,
      data.displayText,
      data.senderId
    )
  );
}

/** Return whether a Lexical node is a reply-target node. */
export function $isReplyTargetNode(
  node: LexicalNode | null | undefined
): node is ReplyTargetNode {
  return node instanceof ReplyTargetNode;
}
