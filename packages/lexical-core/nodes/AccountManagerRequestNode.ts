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
 * The tag a DM message carries for an account manager request. Mirrors the
 * backend's `CARD_TAG`; the payload shape is `{"id": ...}`.
 */
export const ACCOUNT_MANAGER_REQUEST_TAG = 'm-account-manager-request';

const TEXT_CONTENT = 'Account manager request';

export type AccountManagerRequestInfo = {
  /** The grant the card reads its state from. */
  grantId: string;
};

export type SerializedAccountManagerRequestNode = Spread<
  AccountManagerRequestInfo,
  SerializedLexicalNode
>;

export type AccountManagerRequestDecoratorProps = AccountManagerRequestInfo & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAccountManagerGrantId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * The card for one account manager request. Anyone can type message markup, so
 * the node holds only the grant id and the card reads everything it shows from
 * the server, which answers only the two accounts involved.
 */
export class AccountManagerRequestNode extends DecoratorNode<
  DecoratorComponent<AccountManagerRequestDecoratorProps> | undefined
> {
  __grantId: string;

  static getType() {
    return 'account-manager-request';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: AccountManagerRequestNode) {
    return new AccountManagerRequestNode(node.__grantId, node.__key);
  }

  constructor(grantId: string, key?: NodeKey) {
    super(key);
    this.__grantId = grantId;
  }

  static importJSON(serializedNode: SerializedAccountManagerRequestNode) {
    const node = $createAccountManagerRequestNode(serializedNode.grantId);
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedAccountManagerRequestNode {
    return {
      ...super.exportJSON(),
      grantId: this.__grantId,
      type: AccountManagerRequestNode.getType(),
      version: VERSION,
    };
  }

  exportComponentProps(): AccountManagerRequestInfo {
    return { grantId: this.__grantId };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.setAttribute('data-account-manager-request', this.__grantId);
    return span;
  }

  updateDOM(_prevNode: AccountManagerRequestNode, _dom: HTMLElement): boolean {
    return false;
  }

  /** Nothing pastes one of these; they only arrive through the transformer. */
  static importDOM(): DOMConversionMap<HTMLElement> | null {
    return null;
  }

  exportDOM() {
    const element = document.createElement('span');
    element.setAttribute('data-account-manager-request', this.__grantId);
    element.textContent = TEXT_CONTENT;
    return { element };
  }

  getTextContent(): string {
    return TEXT_CONTENT;
  }

  getGrantId(): string {
    return this.__grantId;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<AccountManagerRequestDecoratorProps>(
      AccountManagerRequestNode
    );
    if (decorator) {
      return () =>
        decorator({
          grantId: this.__grantId,
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createAccountManagerRequestNode(
  grantId: string
): AccountManagerRequestNode {
  return $applyNodeReplacement(new AccountManagerRequestNode(grantId));
}

export function $isAccountManagerRequestNode(
  node: AccountManagerRequestNode | LexicalNode | null | undefined
): node is AccountManagerRequestNode {
  return node instanceof AccountManagerRequestNode;
}
