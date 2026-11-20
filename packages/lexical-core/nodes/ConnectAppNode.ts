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

const VERSION = 3;

/**
 * The tag an agent emits when a tool call failed because the person running
 * the session has not connected an app, or the app's connection expired, and
 * the tag the harness posts when `@cursor` was mentioned by someone without a
 * Cursor key. Mirrors the backend's `CONNECT_APP_TAG`; the payload shape is
 * `{"appSlug": ..., "name": ..., "target"?: ..., "reconnect"?: true}`.
 */
export const CONNECT_APP_TAG = 'm-connect-app';

/**
 * Where the chip sends the reader to connect. Absent in older payloads, which
 * were all Pipedream apps, so `connections` is the default.
 */
export const CONNECT_APP_TARGETS = ['connections', 'harness'] as const;

export type ConnectAppTarget = (typeof CONNECT_APP_TARGETS)[number];

export const DEFAULT_CONNECT_APP_TARGET: ConnectAppTarget = 'connections';

export type ConnectAppInfo = {
  /** Pipedream app slug (`linear`) or a harness slug (`cursor`). */
  appSlug: string;
  /** Display name, e.g. `Linear`. */
  name: string;
  /** Settings surface the chip connects through. */
  target: ConnectAppTarget;
  /**
   * The app has a connection whose grant expired: the chip offers to
   * reconnect it even though the app counts as connected. Absent in older
   * payloads, which mean `false`.
   */
  reconnect?: boolean;
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

/** What a chip reads as in plain text: its call to action. */
export function connectAppCallToAction(
  name: string,
  reconnect: boolean
): string {
  return reconnect ? `Reconnect ${name}` : `Connect ${name}`;
}

export function isConnectAppTarget(value: unknown): value is ConnectAppTarget {
  return (CONNECT_APP_TARGETS as readonly unknown[]).includes(value);
}

/**
 * An inline chip offering to connect one integration. Rendered from a reply
 * the agent wrote after the egress proxy told it a Pipedream app was not
 * connected for the session owner (or that its connection expired, with
 * `reconnect`), or from the reply the Cursor bot posts
 * when its mentioner has no Cursor key; clicking it takes the reader to the
 * settings surface named by `target` with that integration ready to connect.
 */
export class ConnectAppNode extends DecoratorNode<
  DecoratorComponent<ConnectAppDecoratorProps> | undefined
> {
  __appSlug: string;
  __name: string;
  __target: ConnectAppTarget;
  __reconnect: boolean;

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
    return new ConnectAppNode(
      node.__appSlug,
      node.__name,
      node.__target,
      node.__reconnect,
      node.__key
    );
  }

  constructor(
    appSlug: string,
    name: string,
    target: ConnectAppTarget = DEFAULT_CONNECT_APP_TARGET,
    reconnect = false,
    key?: NodeKey
  ) {
    super(key);
    this.__appSlug = appSlug;
    this.__name = name;
    this.__target = target;
    this.__reconnect = reconnect;
  }

  static importJSON(serializedNode: SerializedConnectAppNode) {
    const node = $createConnectAppNode(
      serializedNode.appSlug,
      serializedNode.name,
      isConnectAppTarget(serializedNode.target)
        ? serializedNode.target
        : DEFAULT_CONNECT_APP_TARGET,
      serializedNode.reconnect === true
    );
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedConnectAppNode {
    return {
      ...super.exportJSON(),
      appSlug: this.__appSlug,
      name: this.__name,
      target: this.__target,
      reconnect: this.__reconnect,
      type: ConnectAppNode.getType(),
      version: VERSION,
    };
  }

  exportComponentProps(): ConnectAppInfo {
    return {
      appSlug: this.__appSlug,
      name: this.__name,
      target: this.__target,
      reconnect: this.__reconnect,
    };
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
    element.textContent = this.getTextContent();
    return { element };
  }

  getTextContent(): string {
    return connectAppCallToAction(this.__name, this.__reconnect);
  }

  getAppSlug(): string {
    return this.__appSlug;
  }

  getName(): string {
    return this.__name;
  }

  getTarget(): ConnectAppTarget {
    return this.__target;
  }

  getReconnect(): boolean {
    return this.__reconnect;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<ConnectAppDecoratorProps>(ConnectAppNode);
    if (decorator) {
      return () =>
        decorator({
          appSlug: this.__appSlug,
          name: this.__name,
          target: this.__target,
          reconnect: this.__reconnect,
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createConnectAppNode(
  appSlug: string,
  name: string,
  target: ConnectAppTarget = DEFAULT_CONNECT_APP_TARGET,
  reconnect = false
): ConnectAppNode {
  return $applyNodeReplacement(
    new ConnectAppNode(appSlug, name, target, reconnect)
  );
}

export function $isConnectAppNode(
  node: ConnectAppNode | LexicalNode | null | undefined
): node is ConnectAppNode {
  return node instanceof ConnectAppNode;
}
