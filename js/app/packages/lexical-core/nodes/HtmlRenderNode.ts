import {
  $applyNodeReplacement,
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
import { DecoratorBlockNode } from './DecoratorBlockNode';

export type HtmlRenderData = {
  html: string;
};

export type SerializedHtmlRenderNode = Spread<
  HtmlRenderData,
  SerializedLexicalNode
>;

export type HtmlRenderDecoratorProps = HtmlRenderData & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

export class HtmlRenderNode extends DecoratorBlockNode<
  DecoratorComponent<HtmlRenderDecoratorProps> | undefined
> {
  __html: string;

  static getType() {
    return 'html-render';
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: HtmlRenderNode) {
    return new HtmlRenderNode(node.__html, node.__key);
  }

  constructor(html: string, key?: NodeKey) {
    super('left', key);
    this.__html = html;
  }

  static importJSON(serializedNode: SerializedHtmlRenderNode) {
    const node = $createHtmlRenderNode({ html: serializedNode.html });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedHtmlRenderNode {
    return {
      ...super.exportJSON(),
      html: this.__html,
      type: HtmlRenderNode.getType(),
      version: 1,
    };
  }

  exportComponentProps(): HtmlRenderData {
    return {
      html: this.__html,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const container = document.createElement('div');
    container.style.display = 'block';
    container.setAttribute('data-html-render', 'true');
    return container;
  }

  updateDOM(): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap<HTMLDivElement> | null {
    const convert = (domNode: HTMLElement) => {
      if (!domNode.hasAttribute('data-html-render')) {
        return null;
      }

      const dsdTemplate = domNode.querySelector('template[shadowrootmode]');

      const htmlAttr = domNode.getAttribute('data-html');
      const htmlFromAttr = htmlAttr ? JSON.parse(htmlAttr) : null;
      const htmlString = dsdTemplate
        ? dsdTemplate.innerHTML
        : (htmlFromAttr ?? domNode.innerHTML);

      const node = $createHtmlRenderNode({ html: htmlString });
      return { node };
    };

    return {
      div: () => ({ conversion: convert, priority: 1 }),
    };
  }

  exportDOM() {
    const host = document.createElement('div');
    host.setAttribute('data-html-render', 'true');

    const template = document.createElement('template');
    template.setAttribute('shadowrootmode', 'open');
    template.innerHTML = this.__html;

    host.appendChild(template);
    return { element: host };
  }

  getTextContent(): string {
    return '';
  }

  getHtml(): string {
    return this.__html;
  }

  setHtml(html: string) {
    const writable = this.getWritable();
    writable.__html = html;
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const decorator = getDecorator<HtmlRenderNode>(HtmlRenderNode);
    if (decorator) {
      return () =>
        decorator({
          html: this.__html,
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createHtmlRenderNode(params: HtmlRenderData): HtmlRenderNode {
  const node = new HtmlRenderNode(params.html);
  return $applyNodeReplacement(node);
}

export function $isHtmlRenderNode(
  node: HtmlRenderNode | LexicalNode | null | undefined
): node is HtmlRenderNode {
  return node instanceof HtmlRenderNode;
}
