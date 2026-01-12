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

export type GroupMentionInfo = {
  groupAlias: string;
  groupParticipants: string[];
};

export type SerializedGroupMentionNode = Spread<
  GroupMentionInfo,
  SerializedLexicalNode
>;

export type GroupMentionDecoratorProps = {
  groupAlias: string;
  groupParticipants: string[];
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class GroupMentionNode extends DecoratorNode<
  DecoratorComponent<GroupMentionDecoratorProps> | undefined
> {
  __groupAlias: string;
  __groupParticipants: string[];

  static getType() {
    return 'group-mention';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: GroupMentionNode) {
    return new GroupMentionNode(
      node.__groupAlias,
      node.__groupParticipants,
      node.__key
    );
  }

  constructor(
    groupAlias: string,
    groupParticipants: string[],
    key?: NodeKey
  ) {
    super(key);
    this.__groupAlias = groupAlias;
    this.__groupParticipants = groupParticipants;
  }

  static importJSON(serializedNode: SerializedGroupMentionNode) {
    const node = $createGroupMentionNode({
      groupAlias: serializedNode.groupAlias,
      groupParticipants: serializedNode.groupParticipants,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedGroupMentionNode {
    return {
      ...super.exportJSON(),
      groupAlias: this.__groupAlias,
      groupParticipants: this.__groupParticipants,
      type: GroupMentionNode.getType(),
      version: 1,
    };
  }

  exportComponentProps(): GroupMentionInfo {
    return {
      groupAlias: this.__groupAlias,
      groupParticipants: this.__groupParticipants,
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
      'data-group-mention': true,
      'data-group-alias': this.__groupAlias,
      'data-group-participants': JSON.stringify(this.__groupParticipants),
    };
  }

  static importDOM(): DOMConversionMap<HTMLSpanElement> | null {
    return {
      span: (domNode: HTMLSpanElement) => {
        if (!domNode.hasAttribute('data-group-mention')) {
          return null;
        }
        return {
          conversion: (domNode: HTMLElement) => {
            const groupAlias = domNode.getAttribute('data-group-alias');
            const participantsJson = domNode.getAttribute('data-group-participants');

            if (groupAlias && participantsJson) {
              try {
                const groupParticipants = JSON.parse(participantsJson);
                const node = $createGroupMentionNode({
                  groupAlias,
                  groupParticipants,
                });
                return { node };
              } catch {
                return null;
              }
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
    element.textContent = `@${this.__groupAlias}`;
    return { element };
  }

  getTextContent(): string {
    return `@${this.__groupAlias}`;
  }

  getSearchText(): string {
    return '';
  }

  getGroupAlias(): string {
    return this.__groupAlias;
  }

  setGroupAlias(groupAlias: string) {
    const writable = this.getWritable();
    writable.__groupAlias = groupAlias;
  }

  getGroupParticipants(): string[] {
    return this.__groupParticipants;
  }

  setGroupParticipants(groupParticipants: string[]) {
    const writable = this.getWritable();
    writable.__groupParticipants = groupParticipants;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<GroupMentionNode>(GroupMentionNode);
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

export function $createGroupMentionNode(params: {
  groupAlias: string;
  groupParticipants: string[];
}) {
  const node = new GroupMentionNode(
    params.groupAlias,
    params.groupParticipants
  );
  return $applyNodeReplacement(node);
}

export function $isGroupMentionNode(
  node: GroupMentionNode | LexicalNode | null | undefined
): node is GroupMentionNode {
  return node instanceof GroupMentionNode;
}
