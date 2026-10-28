import { WORDML_NS } from './paragraph';
import {
  elementChildren,
  getAttribute,
  isElement,
  namespaceDeclarations,
  parseXml,
  type XmlElement,
} from './xml';

export type ParagraphStyleInfo = {
  id: string;
  name: string;
  next: string | null;
  /** The style paragraphs without a style of their own use. */
  isDefault: boolean;
};

export function prefixFor(node: XmlElement, uri: string): string | null {
  for (const [prefix, value] of namespaceDeclarations(node))
    if (value === uri && prefix) return prefix;
  return null;
}

/** Paragraph styles a styles part defines, in definition order. */
export function paragraphStylesFromXml(
  xml: string | undefined
): ParagraphStyleInfo[] {
  if (!xml) return [];
  const root = parseXml(xml).find(isElement);
  if (!root) return [];
  const w = prefixFor(root, WORDML_NS) ?? 'w';
  const val = (node: XmlElement, local: string) => {
    const child = elementChildren(node).find((c) => c.name === `${w}:${local}`);
    return child ? getAttribute(child, `${w}:val`) : null;
  };
  return elementChildren(root)
    .filter(
      (node) =>
        node.name === `${w}:style` &&
        getAttribute(node, `${w}:type`) === 'paragraph'
    )
    .flatMap((node) => {
      const id = getAttribute(node, `${w}:styleId`);
      return id
        ? [
            {
              id,
              name: val(node, 'name') ?? id,
              next: val(node, 'next'),
              isDefault: getAttribute(node, `${w}:default`) === '1',
            },
          ]
        : [];
    });
}

/** The id of the paragraph style a name or id refers to, or null. */
export function findStyle(
  styles: readonly ParagraphStyleInfo[],
  style: string
): string | null {
  const wanted = style.trim();
  const lower = wanted.toLowerCase();
  const found =
    styles.find((s) => s.id === wanted) ??
    styles.find((s) => s.name.toLowerCase() === lower) ??
    styles.find((s) => s.id.toLowerCase() === lower) ??
    styles.find(
      (s) =>
        s.name.replace(/\s+/g, '').toLowerCase() === lower.replace(/\s+/g, '')
    );
  return found?.id ?? null;
}
