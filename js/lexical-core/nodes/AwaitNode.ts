import {
  $applyNodeReplacement,
  DecoratorNode,
  type EditorConfig,
  type EditorThemeClasses,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { nanoid } from 'nanoid';
import { type DecoratorComponent, getDecorator } from '../decoratorRegistry';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';
import { $applyPeerIdFromSerialized, $getLocal } from '../plugins/peerIdPlugin';

const VERSION = 1;
const AWAIT_ID_LENGTH = 21;

export const AWAIT_NODE_TYPE = 'await';

export type AwaitNodeInfo = {
  awaitId: string;
  text?: string;
  inline?: boolean;
};

export type SerializedAwaitNode = Spread<AwaitNodeInfo, SerializedLexicalNode>;

export type AwaitDecoratorProps = {
  awaitId: string;
  text: string | undefined;
  inline: boolean;
  key: NodeKey;
  theme: EditorThemeClasses;
};

/**
 * Ephemeral placeholder node that represents an in-flight async operation
 * (e.g. a network call to create a task). Created with a unique awaitId so a
 * REPLACE_AWAIT_NODE_COMMAND can later target it for replacement or removal.
 *
 * Visibility is gated on local peer status — non-local peers render nothing,
 * so the pulse only animates for the user that initiated the work.
 */
export class AwaitNode extends DecoratorNode<
  DecoratorComponent<AwaitDecoratorProps> | undefined
> {
  __awaitId: string;
  __text: string | undefined;
  __inline: boolean;

  static getType() {
    return AWAIT_NODE_TYPE;
  }

  static clone(node: AwaitNode) {
    return new AwaitNode(
      node.__awaitId,
      node.__text,
      node.__inline,
      node.__key
    );
  }

  constructor(
    awaitId?: string,
    text?: string,
    inline: boolean = true,
    key?: NodeKey
  ) {
    super(key);
    this.__awaitId = awaitId ?? nanoid(AWAIT_ID_LENGTH);
    this.__text = text;
    this.__inline = inline;
  }

  isInline(): boolean {
    return this.__inline;
  }

  isKeyboardSelectable(): boolean {
    return false;
  }

  static importJSON(serializedNode: SerializedAwaitNode) {
    const node = $createAwaitNode({
      awaitId: serializedNode.awaitId,
      text: serializedNode.text,
      inline: serializedNode.inline,
    });
    $applyIdFromSerialized(node, serializedNode);
    $applyPeerIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedAwaitNode {
    return {
      ...super.exportJSON(),
      awaitId: this.__awaitId,
      text: this.__text,
      inline: this.__inline,
      type: AWAIT_NODE_TYPE,
      version: VERSION,
    };
  }

  exportComponentProps(): AwaitNodeInfo {
    return {
      awaitId: this.__awaitId,
      text: this.__text,
      inline: this.__inline,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const elem = document.createElement(this.__inline ? 'span' : 'div');
    elem.setAttribute('data-await-id', this.__awaitId);
    elem.classList.add('macro-await-node');
    elem.classList.toggle('local', this.isLocal());
    return elem;
  }

  updateDOM(_prevNode: this, element: HTMLElement): boolean {
    element.classList.toggle('local', this.isLocal());
    return false;
  }

  // Await nodes are ephemeral — never serialize to the clipboard / outgoing HTML.
  exportDOM() {
    return { element: null };
  }

  getAwaitId(): string {
    return this.__awaitId;
  }

  getText(): string | undefined {
    return this.__text;
  }

  setText(text: string | undefined) {
    const writable = this.getWritable();
    writable.__text = text;
    return writable;
  }

  getTextContent(): string {
    return '';
  }

  isLocal(): boolean {
    return $getLocal(this) ?? true;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<AwaitDecoratorProps>(AwaitNode);
    if (decorator) {
      return () =>
        decorator({
          awaitId: this.__awaitId,
          text: this.__text,
          inline: this.__inline,
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createAwaitNode(params?: Partial<AwaitNodeInfo>): AwaitNode {
  const node = new AwaitNode(
    params?.awaitId,
    params?.text,
    params?.inline ?? true
  );
  return $applyNodeReplacement(node);
}

export function $isAwaitNode(
  node: AwaitNode | LexicalNode | null | undefined
): node is AwaitNode {
  return node instanceof AwaitNode;
}
