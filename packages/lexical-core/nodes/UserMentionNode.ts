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

export type UserMentionInfo = {
  userId: string;
  email: string;
  displayName?: string;
  mentionUuid?: string;
};

export type SerializedUserMentionNode = Spread<
  UserMentionInfo,
  SerializedLexicalNode
>;

export type UserMentionDecoratorProps = UserMentionInfo & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

type UserMentionConstructorOptions = {
  displayName?: string;
  mentionUuid?: string;
};

function getEmailLocalPart(email: string): string {
  return email.split('@')[0] || email;
}

export class UserMentionNode extends DecoratorNode<
  DecoratorComponent<UserMentionDecoratorProps> | undefined
> {
  __userId: string;
  __email: string;
  __displayName: string;
  __mentionUuid: string | undefined;

  static getType() {
    return 'user-mention';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: UserMentionNode) {
    return new UserMentionNode(
      node.__userId,
      node.__email,
      {
        displayName: node.__displayName,
        mentionUuid: node.__mentionUuid,
      },
      node.__key
    );
  }

  constructor(
    userId: string,
    email: string,
    mentionUuid?: string,
    key?: NodeKey
  );
  constructor(
    userId: string,
    email: string,
    options?: UserMentionConstructorOptions,
    key?: NodeKey
  );
  constructor(
    userId: string,
    email: string,
    mentionUuidOrOptions?: string | UserMentionConstructorOptions,
    key?: NodeKey
  ) {
    super(key);
    const options =
      typeof mentionUuidOrOptions === 'object'
        ? mentionUuidOrOptions
        : undefined;
    const mentionUuid =
      typeof mentionUuidOrOptions === 'string'
        ? mentionUuidOrOptions
        : options?.mentionUuid;

    this.__userId = userId;
    this.__email = email;
    this.__displayName = options?.displayName || getEmailLocalPart(email);
    this.__mentionUuid = mentionUuid;
  }

  static importJSON(serializedNode: SerializedUserMentionNode) {
    const node = $createUserMentionNode({
      userId: serializedNode.userId,
      email: serializedNode.email,
      displayName: serializedNode.displayName,
      mentionUuid: serializedNode.mentionUuid,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedUserMentionNode {
    return {
      ...super.exportJSON(),
      userId: this.__userId,
      email: this.__email,
      displayName: this.__displayName,
      mentionUuid: this.__mentionUuid,
      type: UserMentionNode.getType(),
      version: 1,
    };
  }

  exportComponentProps(): UserMentionInfo {
    return {
      userId: this.__userId,
      email: this.__email,
      displayName: this.__displayName,
      mentionUuid: this.__mentionUuid,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const container = document.createElement('span');
    return container;
  }

  updateDOM(): boolean {
    return false;
  }

  getDataAttrs(): Record<string, string | boolean> {
    return {
      'data-user-mention': true,
      'data-user-id': this.__userId,
      'data-email': this.__email,
      'data-display-name': this.__displayName,
      'data-mention-uuid': this.__mentionUuid || '',
    };
  }

  static importDOM(): DOMConversionMap<HTMLSpanElement> | null {
    return {
      span: (domNode: HTMLSpanElement) => {
        if (!domNode.hasAttribute('data-user-mention')) {
          return null;
        }
        return {
          conversion: (domNode: HTMLElement) => {
            const userId = domNode.getAttribute('data-user-id');
            const email = domNode.getAttribute('data-email');
            const displayName =
              domNode.getAttribute('data-display-name') ?? undefined;

            if (userId && email) {
              const node = $createUserMentionNode({
                userId,
                email,
                displayName,
              });
              return { node };
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
    element.textContent = this.__displayName;
    return { element };
  }

  getTextContent(): string {
    return this.__displayName;
  }

  getSearchText(): string {
    return '';
  }

  getUserId(): string {
    return this.__userId;
  }

  setUserId(userId: string) {
    const writable = this.getWritable();
    writable.__userId = userId;
  }

  getEmail(): string {
    return this.__email;
  }

  setEmail(email: string) {
    const writable = this.getWritable();
    writable.__email = email;
  }

  getDisplayName(): string {
    return this.__displayName;
  }

  setDisplayName(displayName: string) {
    const writable = this.getWritable();
    writable.__displayName = displayName;
  }

  getMentionUuid(): string | undefined {
    return this.__mentionUuid;
  }

  setMentionUuid(mentionUuid: string | undefined) {
    const writable = this.getWritable();
    writable.__mentionUuid = mentionUuid;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<UserMentionDecoratorProps>(UserMentionNode);
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

export function $createUserMentionNode(params: {
  userId: string;
  email: string;
  displayName?: string;
  mentionUuid?: string;
}) {
  const node = new UserMentionNode(params.userId, params.email, {
    displayName: params.displayName,
    mentionUuid: params.mentionUuid,
  });
  return $applyNodeReplacement(node);
}

export function $isUserMentionNode(
  node: UserMentionNode | LexicalNode | null | undefined
): node is UserMentionNode {
  return node instanceof UserMentionNode;
}
