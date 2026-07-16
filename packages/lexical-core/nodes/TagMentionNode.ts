import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMConversion,
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

export type TagMentionInfo = {
  optionId: string;
  propertyDefinitionId: string;
  scope: 'user' | 'team';
  name: string;
  color?: string;
};

export type SerializedTagMentionNode = Spread<
  TagMentionInfo,
  SerializedLexicalNode
>;

export type TagMentionDecoratorProps = TagMentionInfo & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class TagMentionNode extends DecoratorNode<
  DecoratorComponent<TagMentionDecoratorProps> | undefined
> {
  __optionId: string;
  __propertyDefinitionId: string;
  __scope: 'user' | 'team';
  __name: string;
  __color: string | undefined;

  static getType() {
    return 'tag-mention';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: TagMentionNode) {
    return new TagMentionNode(
      node.__optionId,
      node.__propertyDefinitionId,
      node.__scope,
      node.__name,
      node.__color,
      node.__key
    );
  }

  constructor(
    optionId: string,
    propertyDefinitionId: string,
    scope: 'user' | 'team',
    name: string,
    color?: string,
    key?: NodeKey
  ) {
    super(key);
    this.__optionId = optionId;
    this.__propertyDefinitionId = propertyDefinitionId;
    this.__scope = scope;
    this.__name = name;
    this.__color = color;
  }

  static importJSON(serializedNode: SerializedTagMentionNode) {
    const node = $createTagMentionNode({
      optionId: serializedNode.optionId,
      propertyDefinitionId: serializedNode.propertyDefinitionId,
      scope: serializedNode.scope,
      name: serializedNode.name,
      color: serializedNode.color,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedTagMentionNode {
    return {
      ...super.exportJSON(),
      optionId: this.__optionId,
      propertyDefinitionId: this.__propertyDefinitionId,
      scope: this.__scope,
      name: this.__name,
      color: this.__color,
      type: TagMentionNode.getType(),
      version: VERSION,
    };
  }

  exportComponentProps(): TagMentionInfo {
    return {
      optionId: this.__optionId,
      propertyDefinitionId: this.__propertyDefinitionId,
      scope: this.__scope,
      name: this.__name,
      color: this.__color,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const span = document.createElement('span');
    span.setAttribute('data-tag-mention', 'true');
    return span;
  }

  updateDOM(_prevNode: TagMentionNode, _dom: HTMLElement): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLElement> | null {
    const convert = (domNode: HTMLElement) => {
      const optionId = domNode.getAttribute('data-tag-option-id');
      const propertyDefinitionId = domNode.getAttribute(
        'data-tag-property-definition-id'
      );
      const name = domNode.getAttribute('data-tag-name') || '';
      const scope = domNode.getAttribute('data-tag-scope');
      const color = domNode.getAttribute('data-tag-color') || undefined;

      if (
        optionId &&
        propertyDefinitionId &&
        (scope === 'user' || scope === 'team')
      ) {
        return {
          node: $createTagMentionNode({
            optionId,
            propertyDefinitionId,
            scope,
            name,
            color,
          }),
        };
      }

      return null;
    };

    const wrapInCheck = (conversion: DOMConversion) => {
      return (node: HTMLElement) =>
        node.hasAttribute('data-tag-mention') ? conversion : null;
    };

    return {
      span: wrapInCheck({ conversion: convert, priority: 1 }),
    };
  }

  exportDOM() {
    const element = document.createElement('span');
    element.setAttribute('data-tag-mention', 'true');
    element.setAttribute('data-tag-option-id', this.__optionId);
    element.setAttribute(
      'data-tag-property-definition-id',
      this.__propertyDefinitionId
    );
    element.setAttribute('data-tag-name', this.__name);
    element.setAttribute('data-tag-scope', this.__scope);
    if (this.__color) element.setAttribute('data-tag-color', this.__color);
    element.textContent = this.__name;
    return { element };
  }

  getTextContent(): string {
    return this.__name;
  }

  getOptionId(): string {
    return this.__optionId;
  }

  getPropertyDefinitionId(): string {
    return this.__propertyDefinitionId;
  }

  getScope(): 'user' | 'team' {
    return this.__scope;
  }

  getName(): string {
    return this.__name;
  }

  getColor(): string | undefined {
    return this.__color;
  }

  setTagInfo(info: Omit<TagMentionInfo, 'optionId'>) {
    const writable = this.getWritable();
    writable.__propertyDefinitionId = info.propertyDefinitionId;
    writable.__scope = info.scope;
    writable.__name = info.name;
    writable.__color = info.color;
    return writable;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<TagMentionDecoratorProps>(TagMentionNode);
    if (decorator) {
      return () =>
        decorator({
          optionId: this.__optionId,
          propertyDefinitionId: this.__propertyDefinitionId,
          scope: this.__scope,
          name: this.__name,
          color: this.__color,
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createTagMentionNode(params: TagMentionInfo): TagMentionNode {
  const node = new TagMentionNode(
    params.optionId,
    params.propertyDefinitionId,
    params.scope,
    params.name,
    params.color
  );
  return $applyNodeReplacement(node);
}

export function $isTagMentionNode(
  node: TagMentionNode | LexicalNode | null | undefined
): node is TagMentionNode {
  return node instanceof TagMentionNode;
}
