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

export type ContactMentionInfo = {
  contactId: string;
  name: string;
  emailOrDomain: string;
  isCompany: boolean;
  mentionUuid?: string;
};

export type SerializedContactMentionNode = Spread<
  ContactMentionInfo,
  SerializedLexicalNode
>;

export type ContactMentionDecoratorProps = {
  contactId: string;
  name: string;
  emailOrDomain: string;
  isCompany: boolean;
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class ContactMentionNode extends DecoratorNode<
  DecoratorComponent<ContactMentionDecoratorProps> | undefined
> {
  __contactId: string;
  __name: string;
  __emailOrDomain: string;
  __isCompany: boolean;
  __mentionUuid: string | undefined;

  static getType() {
    return 'contact-mention';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: ContactMentionNode) {
    return new ContactMentionNode(
      node.__contactId,
      node.__name,
      node.__emailOrDomain,
      node.__isCompany,
      node.__mentionUuid,
      node.__key
    );
  }

  constructor(
    contactId: string,
    name: string,
    emailOrDomain: string,
    isCompany: boolean,
    mentionUuid?: string,
    key?: NodeKey
  ) {
    super(key);
    this.__contactId = contactId;
    this.__name = name;
    this.__emailOrDomain = emailOrDomain;
    this.__isCompany = isCompany;
    this.__mentionUuid = mentionUuid;
  }

  static importJSON(serializedNode: SerializedContactMentionNode) {
    const node = $createContactMentionNode({
      contactId: serializedNode.contactId,
      name: serializedNode.name,
      emailOrDomain: serializedNode.emailOrDomain,
      isCompany: serializedNode.isCompany,
      mentionUuid: serializedNode.mentionUuid,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedContactMentionNode {
    return {
      ...super.exportJSON(),
      contactId: this.__contactId,
      name: this.__name,
      emailOrDomain: this.__emailOrDomain,
      isCompany: this.__isCompany,
      mentionUuid: this.__mentionUuid,
      type: ContactMentionNode.getType(),
      version: 1,
    };
  }

  exportComponentProps(): ContactMentionInfo {
    return {
      contactId: this.__contactId,
      name: this.__name,
      emailOrDomain: this.__emailOrDomain,
      isCompany: this.__isCompany,
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
      'data-contact-mention': true,
      'data-contact-id': this.__contactId,
      'data-name': this.__name,
      'data-email-or-domain': this.__emailOrDomain,
      'data-is-company': this.__isCompany,
      'data-mention-uuid': this.__mentionUuid || '',
    };
  }

  static importDOM(): DOMConversionMap<HTMLSpanElement> | null {
    return {
      span: (domNode: HTMLSpanElement) => {
        if (!domNode.hasAttribute('data-contact-mention')) {
          return null;
        }
        return {
          conversion: (domNode: HTMLElement) => {
            const contactId = domNode.getAttribute('data-contact-id');
            const name = domNode.getAttribute('data-name');
            const emailOrDomain = domNode.getAttribute('data-email-or-domain');
            const isCompany =
              domNode.getAttribute('data-is-company') === 'true';

            if (contactId && name && emailOrDomain) {
              const node = $createContactMentionNode({
                contactId,
                name,
                emailOrDomain,
                isCompany,
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

  private formatDisplayName(): string {
    // For companies, show the domain
    if (this.__isCompany) {
      return this.__emailOrDomain;
    }

    // For persons, format the name properly
    let name = this.__name.trim();

    // Check if name is in "LastName, FirstName [MiddleInitial]" format
    if (name.includes(',')) {
      const parts = name.split(',').map((p) => p.trim());
      if (parts.length === 2) {
        const lastName = parts[0];
        const firstAndMiddle = parts[1];

        // Parse first name and middle initial
        const nameParts = firstAndMiddle.split(/\s+/);
        const firstName = nameParts[0];

        // Handle middle initials (with or without periods)
        const middleInitials = nameParts
          .slice(1)
          .filter((p) => p.length <= 2 || (p.length === 3 && p.endsWith('.')))
          .map((p) => p.replace('.', ''))
          .join(' ');

        // Format as "FirstName [MiddleInitial] LastName"
        name = middleInitials
          ? `${firstName} ${middleInitials} ${lastName}`
          : `${firstName} ${lastName}`;
      }
    }

    // Capitalize each word properly
    return name
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  exportDOM() {
    const element = document.createElement('span');
    for (const [k, v] of Object.entries(this.getDataAttrs())) {
      element.setAttribute(k, v.toString());
    }
    element.textContent = this.formatDisplayName();
    return { element };
  }

  getTextContent(): string {
    return this.formatDisplayName();
  }

  getSearchText(): string {
    return '';
  }

  getContactId(): string {
    return this.__contactId;
  }

  setContactId(contactId: string) {
    const writable = this.getWritable();
    writable.__contactId = contactId;
  }

  getName(): string {
    return this.__name;
  }

  setName(name: string) {
    const writable = this.getWritable();
    writable.__name = name;
  }

  getEmailOrDomain(): string {
    return this.__emailOrDomain;
  }

  setEmailOrDomain(emailOrDomain: string) {
    const writable = this.getWritable();
    writable.__emailOrDomain = emailOrDomain;
  }

  getIsCompany(): boolean {
    return this.__isCompany;
  }

  setIsCompany(isCompany: boolean) {
    const writable = this.getWritable();
    writable.__isCompany = isCompany;
  }

  getMentionUuid(): string | undefined {
    return this.__mentionUuid;
  }

  setMentionUuid(mentionUuid: string | undefined) {
    const writable = this.getWritable();
    writable.__mentionUuid = mentionUuid;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<ContactMentionNode>(ContactMentionNode);
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

export function $createContactMentionNode(params: {
  contactId: string;
  name: string;
  emailOrDomain: string;
  isCompany: boolean;
  mentionUuid?: string;
}) {
  const node = new ContactMentionNode(
    params.contactId,
    params.name,
    params.emailOrDomain,
    params.isCompany,
    params.mentionUuid
  );
  return $applyNodeReplacement(node);
}

export function $isContactMentionNode(
  node: ContactMentionNode | LexicalNode | null | undefined
): node is ContactMentionNode {
  return node instanceof ContactMentionNode;
}
