import { constructNode, nodeCall, nodeField } from './runtime';

function stringResult(value: unknown): string {
  if (typeof value !== 'string') throw new Error('expected model string');
  return value;
}
function numberResult(value: unknown): number {
  if (typeof value !== 'number') throw new Error('expected model number');
  return value;
}
function booleanResult(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('expected model boolean');
  return value;
}
function nodeResult(value: unknown): LexicalNode {
  if (!(value instanceof LexicalNode)) throw new Error('expected model node');
  return value;
}

/** Native method bodies always select native super; Rust owns nested virtual calls. */
export class LexicalNode {
  constructor(key?: string, text = '') {
    constructNode(this, new.target.getType(), key, text);
    defineNodeFields(this);
  }

  static getType(): string {
    throw new Error('abstract node class');
  }
  getType(): string {
    return stringResult(nodeField(this, '__type'));
  }
  getKey(): string {
    return stringResult(nodeField(this, '__key'));
  }
  getLatest(): LexicalNode {
    return nodeResult(nodeCall(this, 'getLatest', []));
  }
  getWritable(): LexicalNode {
    return nodeResult(nodeCall(this, 'getWritable', []));
  }
  getTextContent(): string {
    return stringResult(nodeCall(this, 'getTextContent', []));
  }
  getTextContentSize(): number {
    return numberResult(nodeCall(this, 'getTextContentSize', []));
  }
  isAttached(): boolean {
    return booleanResult(nodeCall(this, 'isAttached', []));
  }
  isInline(): boolean {
    return booleanResult(nodeCall(this, 'isInline', []));
  }
  isDirty(): boolean {
    return booleanResult(nodeCall(this, 'isDirty', []));
  }
  is(other: LexicalNode | null | undefined): boolean {
    return (
      other !== null &&
      other !== undefined &&
      nodeField(this, '__key') === nodeField(other, '__key')
    );
  }
  getParent(): LexicalNode | null {
    const value = nodeCall(this, 'getParent', []);
    return value === null ? null : nodeResult(value);
  }
  getPreviousSibling(): LexicalNode | null {
    const value = nodeCall(this, 'getPreviousSibling', []);
    return value === null ? null : nodeResult(value);
  }
  getNextSibling(): LexicalNode | null {
    const value = nodeCall(this, 'getNextSibling', []);
    return value === null ? null : nodeResult(value);
  }
  insertAfter(node: LexicalNode, restoreSelection?: boolean): LexicalNode {
    return nodeResult(nodeCall(this, 'insertAfter', [node, restoreSelection]));
  }
  insertBefore(node: LexicalNode, restoreSelection?: boolean): LexicalNode {
    return nodeResult(nodeCall(this, 'insertBefore', [node, restoreSelection]));
  }
  replace(node: LexicalNode, includeChildren?: boolean): LexicalNode {
    return nodeResult(nodeCall(this, 'replace', [node, includeChildren]));
  }
  remove(preserveEmptyParent?: boolean): void {
    nodeCall(this, 'remove', [preserveEmptyParent]);
  }
  markDirty(): void {
    nodeCall(this, 'markDirty', []);
  }
  exportJSON(): unknown {
    return nodeCall(this, 'exportJSON', []);
  }
}

export class ElementNode extends LexicalNode {
  append(...nodes: LexicalNode[]): ElementNode {
    const value = nodeCall(this, 'append', nodes);
    if (!(value instanceof ElementNode))
      throw new Error('expected model element');
    return value;
  }
  getChildren(): LexicalNode[] {
    const value = nodeCall(this, 'getChildren', []);
    if (
      !Array.isArray(value) ||
      !value.every((node) => node instanceof LexicalNode)
    )
      throw new Error('expected model children');
    return value;
  }
  getChildrenSize(): number {
    return numberResult(nodeCall(this, 'getChildrenSize', []));
  }
  getIndent(): number {
    return numberResult(nodeCall(this, 'getIndent', []));
  }
  canBeEmpty(): boolean {
    return booleanResult(nodeCall(this, 'canBeEmpty', []));
  }
  canIndent(): boolean {
    return booleanResult(nodeCall(this, 'canIndent', []));
  }
  isShadowRoot(): boolean {
    return booleanResult(nodeCall(this, 'isShadowRoot', []));
  }
  setIndent(indent: number): ElementNode {
    const value = nodeCall(this, 'setIndent', [indent]);
    if (!(value instanceof ElementNode))
      throw new Error('expected model element');
    return value;
  }
}

export class ParagraphNode extends ElementNode {
  static getType(): string {
    return 'paragraph';
  }
}
export class RootNode extends ElementNode {
  static getType(): string {
    return 'root';
  }
}
export class LineBreakNode extends LexicalNode {
  static getType(): string {
    return 'linebreak';
  }
}
export class DecoratorNode extends LexicalNode {}
export class TextNode extends LexicalNode {
  constructor(text = '', key?: string) {
    super(key, text);
  }
  static getType(): string {
    return 'text';
  }
  setTextContent(text: string): TextNode {
    const value = nodeCall(this, 'setTextContent', [text]);
    if (!(value instanceof TextNode)) throw new Error('expected model text');
    return value;
  }
  getFormat(): number {
    return numberResult(nodeCall(this, 'getFormat', []));
  }
  getStyle(): string {
    return stringResult(nodeCall(this, 'getStyle', []));
  }
  isSimpleText(): boolean {
    return booleanResult(nodeCall(this, 'isSimpleText', []));
  }
  isToken(): boolean {
    return booleanResult(nodeCall(this, 'isToken', []));
  }
  isSegmented(): boolean {
    return booleanResult(nodeCall(this, 'isSegmented', []));
  }
}
export class TabNode extends TextNode {
  static getType(): string {
    return 'tab';
  }
}

function defineNodeFields(node: LexicalNode): void {
  const fields = ['__type', '__key', '__parent', '__prev', '__next'];
  if (node instanceof ElementNode)
    fields.push(
      '__first',
      '__last',
      '__size',
      '__format',
      '__style',
      '__indent',
      '__dir',
      '__textFormat',
      '__textStyle'
    );
  else if (node instanceof TextNode)
    fields.push('__text', '__format', '__style', '__mode', '__detail');
  for (const field of [...fields, '__state']) {
    Object.defineProperty(node, field, {
      enumerable: field !== '__state',
      configurable: true,
      get: () => nodeField(node, field),
    });
  }
}

/** Hydration does not run a constructor or allocate another model record. */
export function nativeNode(type: string): LexicalNode {
  let prototype: object;
  switch (type) {
    case 'root':
      prototype = RootNode.prototype;
      break;
    case 'paragraph':
      prototype = ParagraphNode.prototype;
      break;
    case 'text':
      prototype = TextNode.prototype;
      break;
    case 'tab':
      prototype = TabNode.prototype;
      break;
    case 'linebreak':
      prototype = LineBreakNode.prototype;
      break;
    default:
      throw new Error(`unregistered JS node type ${type}`);
  }
  const node: LexicalNode = Object.create(prototype);
  defineNodeFields(node);
  return node;
}
