/**
 * A minimal XML tree for editing WordprocessingML fragments where no DOM is
 * available (the editing worker). Parsing keeps every start tag, text run and
 * comment as written, so serializing an untouched tree reproduces its input
 * byte for byte; only elements whose attributes change are re-rendered.
 */

export type XmlAttribute = { name: string; value: string };

export type XmlElement = {
  kind: 'element';
  name: string;
  attributes: XmlAttribute[];
  children: XmlNode[];
  /** The start tag as parsed; dropped when the element changes. */
  source?: string;
  selfClosing: boolean;
};

/** Character data, kept escaped as written. */
export type XmlText = { kind: 'text'; raw: string };

/** Comments, CDATA sections, processing instructions and declarations. */
export type XmlVerbatim = { kind: 'verbatim'; raw: string };

export type XmlNode = XmlElement | XmlText | XmlVerbatim;

export class XmlError extends Error {}

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function tagEnd(xml: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < xml.length; i++) {
    const char = xml[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return i + 1;
  }
  throw new XmlError('unterminated tag');
}

function verbatimEnd(xml: string, start: number): number | null {
  const close = xml.startsWith('<!--', start)
    ? '-->'
    : xml.startsWith('<![CDATA[', start)
      ? ']]>'
      : xml.startsWith('<?', start)
        ? '?>'
        : xml.startsWith('<!', start)
          ? '>'
          : null;
  if (!close) return null;
  const end = xml.indexOf(close, start + 2);
  if (end < 0) throw new XmlError('unterminated markup declaration');
  return end + close.length;
}

/** Parse a fragment: any number of elements, text and verbatim nodes. */
export function parseXml(xml: string): XmlNode[] {
  const root: XmlElement = element('#root');
  const stack: XmlElement[] = [root];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const textEnd = lt < 0 ? xml.length : lt;
    if (textEnd > i)
      stack[stack.length - 1].children.push({
        kind: 'text',
        raw: xml.slice(i, textEnd),
      });
    if (lt < 0) break;
    const verbatim = verbatimEnd(xml, lt);
    if (verbatim !== null) {
      stack[stack.length - 1].children.push({
        kind: 'verbatim',
        raw: xml.slice(lt, verbatim),
      });
      i = verbatim;
      continue;
    }
    const end = tagEnd(xml, lt);
    const tag = xml.slice(lt, end);
    if (tag[1] === '/') {
      const name = tag.slice(2, -1).trim();
      const open = stack.pop();
      if (!open || open === root || open.name !== name)
        throw new XmlError(`unexpected </${name}>`);
    } else {
      const name = /^<([^\s/>]+)/.exec(tag)?.[1];
      if (!name) throw new XmlError('malformed start tag');
      const selfClosing = tag.endsWith('/>');
      const attributes: XmlAttribute[] = [];
      for (const match of tag
        .slice(name.length + 1, selfClosing ? -2 : -1)
        .matchAll(ATTRIBUTE))
        attributes.push({ name: match[1], value: match[2] ?? match[3] });
      const node: XmlElement = {
        kind: 'element',
        name,
        attributes,
        children: [],
        source: tag,
        selfClosing,
      };
      stack[stack.length - 1].children.push(node);
      if (!selfClosing) stack.push(node);
    }
    i = end;
  }
  if (stack.length > 1)
    throw new XmlError(`unterminated <${stack[stack.length - 1].name}>`);
  return root.children;
}

/** Parse a fragment that is exactly one element. */
export function parseElement(xml: string): XmlElement {
  const nodes = parseXml(xml);
  const elements = nodes.filter(isElement);
  if (elements.length !== 1 || nodes.length !== 1)
    throw new XmlError('expected a single element');
  return elements[0];
}

function startTag(node: XmlElement, selfClosing: boolean): string {
  if (node.source !== undefined && node.selfClosing === selfClosing)
    return node.source;
  const attributes = node.attributes
    .map(({ name, value }) => ` ${name}="${value}"`)
    .join('');
  return `<${node.name}${attributes}${selfClosing ? ' />' : '>'}`;
}

export function serializeXml(nodes: XmlNode | readonly XmlNode[]): string {
  const list = Array.isArray(nodes) ? nodes : [nodes as XmlNode];
  let out = '';
  for (const node of list) {
    if (node.kind !== 'element') out += node.raw;
    else if (node.children.length === 0 && node.selfClosing)
      out += startTag(node, true);
    else
      out += `${startTag(node, false)}${serializeXml(node.children)}</${node.name}>`;
  }
  return out;
}

export function isElement(node: XmlNode | undefined): node is XmlElement {
  return node?.kind === 'element';
}

/** A new element; `attributes` values are plain text and get escaped. */
export function element(
  name: string,
  attributes: Record<string, string> = {},
  children: XmlNode[] = []
): XmlElement {
  return {
    kind: 'element',
    name,
    attributes: Object.entries(attributes).map(([key, value]) => ({
      name: key,
      value: escapeAttribute(value),
    })),
    children,
    selfClosing: true,
  };
}

export function textNode(text: string): XmlText {
  return { kind: 'text', raw: escapeText(text) };
}

export function elementChildren(node: XmlElement): XmlElement[] {
  return node.children.filter(isElement);
}

export function getAttribute(node: XmlElement, name: string): string | null {
  const found = node.attributes.find((attribute) => attribute.name === name);
  return found ? decodeXml(found.value) : null;
}

export function setAttribute(node: XmlElement, name: string, value: string) {
  const escaped = escapeAttribute(value);
  const found = node.attributes.find((attribute) => attribute.name === name);
  if (found?.value === escaped) return;
  if (found) found.value = escaped;
  else node.attributes.push({ name, value: escaped });
  node.source = undefined;
}

export function removeAttribute(node: XmlElement, name: string) {
  const index = node.attributes.findIndex(
    (attribute) => attribute.name === name
  );
  if (index < 0) return;
  node.attributes.splice(index, 1);
  node.source = undefined;
}

/** The plain text of a node's character data, entities decoded. */
export function textContent(node: XmlNode): string {
  if (node.kind === 'text') return decodeXml(node.raw);
  if (node.kind === 'verbatim')
    return node.raw.startsWith('<![CDATA[') ? node.raw.slice(9, -3) : '';
  return node.children.map(textContent).join('');
}

/** A deep copy; the copy re-renders nothing it does not have to. */
export function cloneElement(node: XmlElement): XmlElement {
  return {
    ...node,
    attributes: node.attributes.map((attribute) => ({ ...attribute })),
    children: node.children.map((child) =>
      child.kind === 'element' ? cloneElement(child) : { ...child }
    ),
  };
}

/** Namespace declarations on `node`: prefix → URI ('' is the default). */
export function namespaceDeclarations(node: XmlElement): Map<string, string> {
  const found = new Map<string, string>();
  for (const { name, value } of node.attributes) {
    if (name === 'xmlns') found.set('', decodeXml(value));
    else if (name.startsWith('xmlns:'))
      found.set(name.slice(6), decodeXml(value));
  }
  return found;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeXml(raw: string): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, body: string) => {
    if (body[0] === '#')
      return String.fromCodePoint(
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      );
    return NAMED_ENTITIES[body] ?? entity;
  });
}

export function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeAttribute(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}
