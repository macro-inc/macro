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
  mentionUuid?: string;
};

export type SerializedUserMentionNode = Spread<
  UserMentionInfo,
  SerializedLexicalNode
>;

export type UserMentionDecoratorProps = {
  userId: String;
  email: String;
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class UserMentionNode extends DecoratorNode<
  DecoratorComponent<UserMentionDecoratorProps> | undefined
> {
  __userId: string;
  __email: string;
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
      node.__mentionUuid,
      node.__key
    );
  }

  constructor(
    userId: string,
    email: string,
    mentionUuid?: string,
    key?: NodeKey
  ) {
    super(key);
    this.__userId = userId;
    this.__email = email;
    this.__mentionUuid = mentionUuid;
  }

  static importJSON(serializedNode: SerializedUserMentionNode) {
    const node = $createUserMentionNode({
      userId: serializedNode.userId,
      email: serializedNode.email,
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
      mentionUuid: this.__mentionUuid,
      type: UserMentionNode.getType(),
      version: 1,
    };
  }

  exportComponentProps(): UserMentionInfo {
    return {
      userId: this.__userId,
      email: this.__email,
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

            if (userId && email) {
              const node = $createUserMentionNode({
                userId,
                email,
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
    element.textContent = this.__email;
    return { element };
  }

  getTextContent(): string {
    return this.__email;
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

  getMentionUuid(): string | undefined {
    return this.__mentionUuid;
  }

  setMentionUuid(mentionUuid: string | undefined) {
    const writable = this.getWritable();
    writable.__mentionUuid = mentionUuid;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<UserMentionNode>(UserMentionNode);
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
  mentionUuid?: string;
}) {
  const node = new UserMentionNode(
    params.userId,
    params.email,
    params.mentionUuid
  );
  return $applyNodeReplacement(node);
}

export function $isUserMentionNode(
  node: UserMentionNode | LexicalNode | null | undefined
): node is UserMentionNode {
  return node instanceof UserMentionNode;
}
