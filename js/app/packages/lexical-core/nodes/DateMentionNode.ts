import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMConversionMap,
  type EditorConfig,
  type EditorThemeClasses,
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { type DecoratorComponent, getDecorator } from '../decoratorRegistry';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';

export type DateMentionInfo = {
  date: string; // ISO date string
  displayFormat: string; // How the date is displayed (e.g., "March 15, 2024")
  mentionUuid?: string;
};

export type SerializedDateMentionNode = Spread<
  DateMentionInfo,
  SerializedLexicalNode
>;

export type DateMentionDecoratorProps = {
  date: string;
  displayFormat: string;
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class DateMentionNode extends DecoratorNode<
  DecoratorComponent<DateMentionDecoratorProps> | undefined
> {
  __date: string;
  __displayFormat: string;
  __mentionUuid: string | undefined;

  static getType() {
    return 'date-mention';
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: DateMentionNode) {
    return new DateMentionNode(
      node.__date,
      node.__displayFormat,
      node.__mentionUuid,
      node.__key
    );
  }

  constructor(
    date: string,
    displayFormat: string,
    mentionUuid?: string,
    key?: NodeKey
  ) {
    super(key);
    this.__date = date;
    this.__displayFormat = displayFormat;
    this.__mentionUuid = mentionUuid;
  }

  static importJSON(serializedNode: SerializedDateMentionNode) {
    const node = $createDateMentionNode({
      date: serializedNode.date,
      displayFormat: serializedNode.displayFormat,
      mentionUuid: serializedNode.mentionUuid,
    }).updateFromJSON(serializedNode);
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedDateMentionNode {
    return {
      ...super.exportJSON(),
      date: this.__date,
      displayFormat: this.__displayFormat,
      mentionUuid: this.__mentionUuid,
      type: DateMentionNode.getType(),
      version: 1,
    };
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedDateMentionNode>
  ): this {
    const self = super.updateFromJSON(serializedNode);
    self.setDate(serializedNode.date);
    self.setDisplayFormat(serializedNode.displayFormat);
    self.setMentionUuid(serializedNode.mentionUuid);
    return self;
  }

  exportComponentProps(): DateMentionInfo {
    return {
      date: this.__date,
      displayFormat: this.__displayFormat,
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
      'data-date-mention': true,
      'data-date': this.__date,
      'data-display-format': this.__displayFormat,
      'data-mention-uuid': this.__mentionUuid || '',
    };
  }

  static importDOM(): DOMConversionMap<HTMLSpanElement> | null {
    return {
      span: (domNode: HTMLSpanElement) => {
        if (!domNode.hasAttribute('data-date-mention')) {
          return null;
        }
        return {
          conversion: (domNode: HTMLElement) => {
            const date = domNode.getAttribute('data-date');
            const displayFormat = domNode.getAttribute('data-display-format');

            if (date && displayFormat) {
              const node = $createDateMentionNode({
                date,
                displayFormat,
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
    element.textContent = this.__displayFormat;
    return { element };
  }

  getTextContent(): string {
    return this.__displayFormat;
  }

  getSearchText(): string {
    return this.__displayFormat;
  }

  getDate(): string {
    return this.__date;
  }

  setDate(date: string) {
    const writable = this.getWritable();
    writable.__date = date;
  }

  getDisplayFormat(): string {
    return this.__displayFormat;
  }

  setDisplayFormat(displayFormat: string) {
    const writable = this.getWritable();
    writable.__displayFormat = displayFormat;
  }

  getMentionUuid(): string | undefined {
    return this.__mentionUuid;
  }

  setMentionUuid(mentionUuid: string | undefined) {
    const writable = this.getWritable();
    writable.__mentionUuid = mentionUuid;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<DateMentionNode>(DateMentionNode);
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

export function $createDateMentionNode(params: {
  date: string;
  displayFormat: string;
  mentionUuid?: string;
}) {
  const node = new DateMentionNode(
    params.date,
    params.displayFormat,
    params.mentionUuid
  );
  return $applyNodeReplacement(node);
}

export function $isDateMentionNode(
  node: DateMentionNode | LexicalNode | null | undefined
): node is DateMentionNode {
  return node instanceof DateMentionNode;
}
