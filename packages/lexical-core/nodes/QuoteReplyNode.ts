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

export const QUOTE_REPLY_NODE_TYPE = 'quote-reply';
export const QUOTE_REPLY_NODE_TAG = 'm-quote-reply';

/** The message reference and preview persisted by a quote-reply node. */
export type QuoteReplyData = {
  channelId: string;
  targetMessageId: string;
  targetThreadId: string;
  displayText: string;
  senderId: string;
};

/** Return whether a value is a valid quote-reply-node payload. */
export function isQuoteReplyData(value: unknown): value is QuoteReplyData {
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

/** Serialize quote-reply data into the internal Markdown representation. */
export function buildQuoteReplyMarkdown(data: QuoteReplyData): string {
  const payload = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<${QUOTE_REPLY_NODE_TAG}>${payload}</${QUOTE_REPLY_NODE_TAG}>`;
}

/** Remove one leading quote-reply block from internal Markdown. */
export function stripLeadingQuoteReplyMarkdown(markdown: string): string {
  const pattern = new RegExp(
    `^\\s*<${QUOTE_REPLY_NODE_TAG}>.*?<\\/${QUOTE_REPLY_NODE_TAG}>\\s*`,
    's'
  );
  return markdown.replace(pattern, '');
}

/** Serialized form of a quote-reply node. */
export type SerializedQuoteReplyNode = Spread<
  QuoteReplyData,
  SerializedLexicalNode
>;

/** Props passed to the application-provided quote-reply decorator. */
export type QuoteReplyDecoratorProps = QuoteReplyData & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

/** A block-level reference to another message in a channel thread. */
export class QuoteReplyNode extends DecoratorNode<
  DecoratorComponent<QuoteReplyDecoratorProps> | undefined
> {
  __channelId: string;
  __targetMessageId: string;
  __targetThreadId: string;
  __displayText: string;
  __senderId: string;

  static getType(): typeof QUOTE_REPLY_NODE_TYPE {
    return QUOTE_REPLY_NODE_TYPE;
  }

  static clone(node: QuoteReplyNode): QuoteReplyNode {
    return new QuoteReplyNode(
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

  static importJSON(serializedNode: SerializedQuoteReplyNode): QuoteReplyNode {
    if (!isQuoteReplyData(serializedNode)) {
      throw new Error('invalid quote-reply data');
    }
    const node = $createQuoteReplyNode(serializedNode);
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedQuoteReplyNode {
    return {
      ...super.exportJSON(),
      ...this.exportComponentProps(),
      type: QUOTE_REPLY_NODE_TYPE,
      version: VERSION,
    };
  }

  exportComponentProps(): QuoteReplyData {
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
    element.setAttribute('data-quote-reply-node', this.__targetMessageId);
    return element;
  }

  updateDOM(): false {
    return false;
  }

  exportDOM() {
    const element = document.createElement('div');
    element.setAttribute('data-quote-reply-node', this.__targetMessageId);
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
    const decorator = getDecorator<QuoteReplyDecoratorProps>(QuoteReplyNode);
    if (!decorator) return;
    return () =>
      decorator({
        ...this.exportComponentProps(),
        key: this.getKey(),
        theme: config.theme,
      });
  }
}

/** Create a block-level channel quote-reply reference. */
export function $createQuoteReplyNode(data: QuoteReplyData): QuoteReplyNode {
  return $applyNodeReplacement(
    new QuoteReplyNode(
      data.channelId,
      data.targetMessageId,
      data.targetThreadId,
      data.displayText,
      data.senderId
    )
  );
}

/** Return whether a Lexical node is a quote-reply node. */
export function $isQuoteReplyNode(
  node: LexicalNode | null | undefined
): node is QuoteReplyNode {
  return node instanceof QuoteReplyNode;
}
