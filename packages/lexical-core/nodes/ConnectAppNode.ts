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

/**
 * The tag an agent emits when a tool call failed because the person running
 * the session has not connected an app. Mirrors the egress proxy's
 * `CONNECT_APP_TAG`; the payload shape is `{"appSlug": ..., "name": ...}`.
 */
export const CONNECT_APP_TAG = 'm-connect-app';

export type ConnectAppInfo = {
  /** Pipedream app slug, e.g. `linear`. */
  appSlug: string;
  /** Display name, e.g. `Linear`. */
  name: string;
};

export type SerializedConnectAppNode = Spread<
  ConnectAppInfo,
  SerializedLexicalNode
>;

export type ConnectAppDecoratorProps = ConnectAppInfo & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

/** Only slugs the egress proxy would route: lowercase ascii, digits, `-`, `_`. */
export function isConnectAppSlug(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9_-]+$/.test(value);
}

/**
 * An inline chip offering to connect one Pipedream app. Rendered from a reply
 * the agent wrote after the egress proxy told it the app was not connected
 * for the session owner; clicking it takes the reader to Settings →
 * Connections with that app ready to connect.
 */
export class ConnectAppNode extends DecoratorNode<
  DecoratorComponent<ConnectAppDecoratorProps> | undefined
> {
  __appSlug: string;
  __name: string;

  static getType() {
    return 'connect-app';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: ConnectAppNode) {
    return new ConnectAppNode(node.__appSlug, node.__name, node.__key);
  }

  constructor(appSlug: string, name: string, key?: NodeKey) {
    super(key);
    this.__appSlug = appSlug;
    this.__name = name;
  }

  static importJSON(serializedNode: SerializedConnectAppNode) {
    const node = $createConnectAppNode(
      serializedNode.appSlug,
      serializedNode.name
    );
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedConnectAppNode {
    return {
      ...super.exportJSON(),
      appSlug: this.__appSlug,
      name: this.__name,
      type: ConnectAppNode.getType(),
      version: VERSION,
    };
  }

  exportComponentProps(): ConnectAppInfo {
    return { appSlug: this.__appSlug, name: this.__name };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.setAttribute('data-connect-app', this.__appSlug);
    return span;
  }

  updateDOM(_prevNode: ConnectAppNode, _dom: HTMLElement): boolean {
    return false;
  }

  /** Nothing pastes one of these; they only arrive through the transformer. */
  static importDOM(): DOMConversionMap<HTMLElement> | null {
    return null;
  }

  exportDOM() {
    const element = document.createElement('span');
    element.setAttribute('data-connect-app', this.__appSlug);
    element.textContent = `Connect ${this.__name}`;
    return { element };
  }

  getTextContent(): string {
    return `Connect ${this.__name}`;
  }

  getAppSlug(): string {
    return this.__appSlug;
  }

  getName(): string {
    return this.__name;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<ConnectAppDecoratorProps>(ConnectAppNode);
    if (decorator) {
      return () =>
        decorator({
          appSlug: this.__appSlug,
          name: this.__name,
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createConnectAppNode(
  appSlug: string,
  name: string
): ConnectAppNode {
  return $applyNodeReplacement(new ConnectAppNode(appSlug, name));
}

export function $isConnectAppNode(
  node: ConnectAppNode | LexicalNode | null | undefined
): node is ConnectAppNode {
  return node instanceof ConnectAppNode;
}
