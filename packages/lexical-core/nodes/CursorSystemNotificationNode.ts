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

const VERSION = 1;

export const CURSOR_SYSTEM_NOTIFICATION_NODE_TYPE = 'system-notification';

/**
 * The tag Cursor's cloud agents wrap an event notification in. When a run
 * subscribes to something outside the conversation — a CI check, a pull
 * request, a Slack thread, a Linear issue, a timer — the event arrives as a
 * prompt Cursor writes itself, shaped like
 *
 * ```
 * <system_notification source="github" repo="github.com/org/repo" conclusion="success" checks="27" subscriptionType="github:ci:branch">
 * All 27 CI checks completed without failures.
 * </system_notification>
 * ```
 *
 * Unlike the `<m-*>` tags this package owns, the attributes ride on the
 * opening tag rather than as a JSON body, and the body is the human-readable
 * summary. Nothing in Macro writes one; they only arrive through the Cursor
 * transport, so the node exists to read them.
 */
export const CURSOR_SYSTEM_NOTIFICATION_TAG = 'system_notification';

/** What one notification carries. */
export type CursorSystemNotificationData = {
  /** Who raised the event: `github`, `slack`, `linear`, `timer`, … */
  source: string;
  /** Every attribute on the opening tag except `source`, in tag order. */
  attributes: Record<string, string>;
  /** The human-readable summary between the tags, trimmed. */
  text: string;
};

/** Return whether a value is a system-notification payload. */
export function isCursorSystemNotificationData(
  value: unknown
): value is CursorSystemNotificationData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.source === 'string' &&
    typeof data.text === 'string' &&
    !!data.attributes &&
    typeof data.attributes === 'object' &&
    Object.values(data.attributes as Record<string, unknown>).every(
      (attribute) => typeof attribute === 'string'
    )
  );
}

export type SerializedCursorSystemNotificationNode = Spread<
  CursorSystemNotificationData & {
    type: typeof CURSOR_SYSTEM_NOTIFICATION_NODE_TYPE;
  },
  SerializedLexicalNode
>;

export type CursorSystemNotificationDecoratorProps =
  CursorSystemNotificationData & {
    key: NodeKey;
    theme: EditorThemeClasses;
  };

/**
 * A block-level card for one event notification a Cursor run received. Reads
 * as an event that happened to the session rather than as something a person
 * typed.
 */
export class CursorSystemNotificationNode extends DecoratorNode<
  DecoratorComponent<CursorSystemNotificationDecoratorProps> | undefined
> {
  __source: string;
  __attributes: Record<string, string>;
  __text: string;

  static getType(): typeof CURSOR_SYSTEM_NOTIFICATION_NODE_TYPE {
    return CURSOR_SYSTEM_NOTIFICATION_NODE_TYPE;
  }

  static clone(
    node: CursorSystemNotificationNode
  ): CursorSystemNotificationNode {
    return new CursorSystemNotificationNode(
      node.__source,
      node.__attributes,
      node.__text,
      node.__key
    );
  }

  constructor(
    source: string,
    attributes: Record<string, string>,
    text: string,
    key?: NodeKey
  ) {
    super(key);
    this.__source = source;
    this.__attributes = { ...attributes };
    this.__text = text;
  }

  static importJSON(
    serializedNode: SerializedCursorSystemNotificationNode
  ): CursorSystemNotificationNode {
    if (!isCursorSystemNotificationData(serializedNode)) {
      throw new Error('invalid system notification data');
    }
    const node = $createCursorSystemNotificationNode(serializedNode);
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedCursorSystemNotificationNode {
    return {
      ...super.exportJSON(),
      ...this.exportComponentProps(),
      type: CURSOR_SYSTEM_NOTIFICATION_NODE_TYPE,
      version: VERSION,
    };
  }

  exportComponentProps(): CursorSystemNotificationData {
    return {
      source: this.__source,
      attributes: { ...this.__attributes },
      text: this.__text,
    };
  }

  getSource(): string {
    return this.__source;
  }

  getAttributes(): Record<string, string> {
    return { ...this.__attributes };
  }

  getText(): string {
    return this.__text;
  }

  isInline(): false {
    return false;
  }

  isKeyboardSelectable(): true {
    return true;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('div');
    element.setAttribute('data-system-notification', this.__source);
    return element;
  }

  updateDOM(): false {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement('div');
    element.setAttribute('data-system-notification', this.__source);
    element.textContent = this.__text;
    return { element };
  }

  /** Nothing pastes one of these; they only arrive through the transformer. */
  static importDOM(): DOMConversionMap | null {
    return null;
  }

  getTextContent(): string {
    return this.__text;
  }

  getSearchText(): string {
    return this.__text;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<CursorSystemNotificationDecoratorProps>(
      CursorSystemNotificationNode
    );
    if (!decorator) return;
    return () =>
      decorator({
        ...this.exportComponentProps(),
        key: this.getKey(),
        theme: config.theme,
      });
  }
}

/** Create a system notification card. */
export function $createCursorSystemNotificationNode(
  data: CursorSystemNotificationData
): CursorSystemNotificationNode {
  return $applyNodeReplacement(
    new CursorSystemNotificationNode(data.source, data.attributes, data.text)
  );
}

/** Return whether a Lexical node is a system notification. */
export function $isCursorSystemNotificationNode(
  node: LexicalNode | null | undefined
): node is CursorSystemNotificationNode {
  return node instanceof CursorSystemNotificationNode;
}
