import type {
  IClipboardDomMsg,
  IClipboardMsg,
  IHtmlNodeMsg,
} from '@macro-inc/collaboration/session/abi.generated';

/** Serialize the native export tree with the receiving browser's DOM and CSSOM. */
export function serializeClipboardDom(
  data: IClipboardDomMsg,
  document: Document
): IClipboardMsg {
  // Template content has an inert owner document, without live custom-element upgrades.
  const owner = document.createElement('template').content.ownerDocument;
  const container = owner.createElement('div');
  for (const node of data.nodes) append(container, node, owner);
  return {
    plain: data.plain,
    lexical: data.lexical,
    html: container.innerHTML,
  };
}

function append(parent: Element, node: IHtmlNodeMsg, document: Document): void {
  const target =
    parent.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
    parent.localName === 'template'
      ? (parent as HTMLTemplateElement).content
      : parent;
  switch (node.kind) {
    case 0: {
      let element: Element = document.createElement(node.tag);
      for (const attribute of node.attributes) {
        if (attribute.property) {
          Reflect.set(element, attribute.name, attribute.value);
        } else if (attribute.styles.length > 0) {
          const style = document.createElement('span').style;
          for (const property of attribute.styles)
            style.setProperty(property.name, property.value);
          if (style.cssText)
            element.setAttribute(attribute.name, style.cssText);
        } else {
          element.setAttribute(attribute.name, attribute.value);
        }
      }
      element = contextualElement(parent, element, document);
      for (const child of node.children) append(element, child, document);
      target.appendChild(element);
      return;
    }
    case 1:
      target.appendChild(document.createTextNode(node.text));
      return;
    case 2:
      for (const child of node.children) append(parent, child, document);
      return;
    case 3: {
      // Only the native fragment parser can produce this already-serialized node.
      const range = document.createRange();
      range.selectNodeContents(parent);
      target.appendChild(range.createContextualFragment(node.text));
      return;
    }
    default:
      throw new Error('Unknown native clipboard DOM node');
  }
}

function contextualElement(
  parent: Element,
  input: Element,
  document: Document
): Element {
  const tag = input.localName;
  if (
    parent.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
    tag.toLowerCase() !== 'svg' &&
    tag.toLowerCase() !== 'math'
  ) {
    return input;
  }

  // Let the browser handle SVG/MathML names and HTML integration points.
  const range = document.createRange();
  range.selectNodeContents(parent);
  const element = range.createContextualFragment(
    input.outerHTML
  ).firstElementChild;
  if (!element || element.localName.toLowerCase() !== tag.toLowerCase()) {
    throw new Error('Invalid native clipboard DOM element');
  }
  return element;
}
