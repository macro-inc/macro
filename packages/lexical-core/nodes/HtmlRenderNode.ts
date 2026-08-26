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
  /** Display-only hint: adapt colors to the app theme when rendering
   * (mirrors the email message view). Undefined = decide from content. */
  adaptColors?: boolean;
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
  __adaptColors?: boolean;

  static getType() {
    return 'html-render';
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: HtmlRenderNode) {
    return new HtmlRenderNode(node.__html, node.__adaptColors, node.__key);
  }

  constructor(html: string, adaptColors?: boolean, key?: NodeKey) {
    super('left', key);
    this.__html = html;
    this.__adaptColors = adaptColors;
  }

  static importJSON(serializedNode: SerializedHtmlRenderNode) {
    const node = $createHtmlRenderNode({
      html: serializedNode.html,
      adaptColors: serializedNode.adaptColors,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedHtmlRenderNode {
    return {
      ...super.exportJSON(),
      html: this.__html,
      adaptColors: this.__adaptColors,
      type: HtmlRenderNode.getType(),
      version: 1,
    };
  }

  exportComponentProps(): HtmlRenderData {
    return {
      html: this.__html,
      adaptColors: this.__adaptColors,
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
      // The backend sanitizer strips data-* attributes but keeps classes, so
      // the class marker is what survives a draft save/restore round-trip
      if (
        !domNode.hasAttribute('data-html-render') &&
        !domNode.classList.contains('macro_html_render')
      ) {
        return null;
      }

      const dsdTemplate = domNode.querySelector('template[shadowrootmode]');

      const htmlAttr = domNode.getAttribute('data-html');
      const htmlFromAttr = htmlAttr ? JSON.parse(htmlAttr) : null;
      const htmlString = dsdTemplate
        ? dsdTemplate.innerHTML
        : (htmlFromAttr ?? domNode.innerHTML);

      const node = $createHtmlRenderNode({
        html: htmlString,
        adaptColors: domNode.classList.contains('macro_html_render_adapt')
          ? true
          : undefined,
      });
      return { node };
    };

    return {
      // Decline non-matching divs in the claim itself: the importer picks a
      // single claimant per element (ties go to the first registered node)
      // and never falls back when its conversion returns null, so an
      // unconditional claim here would swallow every other node's divs.
      div: (domNode: HTMLElement) =>
        domNode.hasAttribute('data-html-render') ||
        domNode.classList.contains('macro_html_render')
          ? { conversion: convert, priority: 1 }
          : null,
    };
  }

  exportDOM() {
    const host = document.createElement('div');
    host.setAttribute('data-html-render', 'true');
    // Class markers survive the backend sanitizer (data-* attributes don't)
    host.className = this.__adaptColors
      ? 'macro_html_render macro_html_render_adapt'
      : 'macro_html_render';

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
    const decorator = getDecorator<HtmlRenderDecoratorProps>(HtmlRenderNode);
    if (decorator) {
      return () =>
        decorator({
          html: this.__html,
          adaptColors: this.__adaptColors,
          key: this.getKey(),
          theme: config.theme,
        });
    }
  }
}

export function $createHtmlRenderNode(params: HtmlRenderData): HtmlRenderNode {
  const node = new HtmlRenderNode(params.html, params.adaptColors);
  return $applyNodeReplacement(node);
}

export function $isHtmlRenderNode(
  node: HtmlRenderNode | LexicalNode | null | undefined
): node is HtmlRenderNode {
  return node instanceof HtmlRenderNode;
}
