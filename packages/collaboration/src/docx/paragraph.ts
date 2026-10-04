import {
  cloneElement,
  element,
  elementChildren,
  getAttribute,
  isElement,
  removeAttribute,
  setAttribute,
  textContent,
  textNode,
  type XmlElement,
  type XmlNode,
} from './xml';

export const WORDML_NS =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const POWERTOOLS_NS = 'http://powertools.codeplex.com/2011';

/** The prefixes a block binds WordprocessingML and the engine's ids to. */
export type Names = { w: string; pt: string };

export const qualified = (names: Names, local: string) => `${names.w}:${local}`;

export function localName(node: XmlElement): string {
  const colon = node.name.indexOf(':');
  return colon < 0 ? node.name : node.name.slice(colon + 1);
}

export function isW(node: XmlNode | undefined, names: Names, local: string) {
  return isElement(node) && node.name === `${names.w}:${local}`;
}

/** The engine's persisted id of an element (`PtOpenXml:Unid`). */
export function unidOf(node: XmlElement, names: Names): string | null {
  return getAttribute(node, `${names.pt}:Unid`);
}

/** A fresh id in the engine's format: 32 lowercase hex digits. */
export function newUnid(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Give `node` and everything inside it fresh engine ids. */
export function stampUnids(node: XmlElement, names: Names): XmlElement {
  setAttribute(node, `${names.pt}:Unid`, newUnid());
  for (const child of elementChildren(node)) stampUnids(child, names);
  return node;
}

/** A copy of `node` that shares no engine ids with it. */
export function cloneFresh(node: XmlElement, names: Names): XmlElement {
  return stampUnids(cloneElement(node), names);
}

/** Wrappers whose runs are part of the paragraph's text. */
const TEXT_CONTAINERS = new Set([
  'hyperlink',
  'ins',
  'moveTo',
  'smartTag',
  'customXml',
  'fldSimple',
  'dir',
  'bdo',
  'sdt',
  'sdtContent',
]);

/** One visible character source inside a run. */
export type Segment = {
  node: XmlElement;
  run: XmlElement;
  text: string;
  start: number;
};

function segmentText(node: XmlElement): string | null {
  switch (localName(node)) {
    case 't':
      return textContent(node);
    case 'tab':
      return '\t';
    case 'br':
    case 'cr':
      return '\n';
    case 'noBreakHyphen':
      return '-';
    default:
      return null;
  }
}

/** The paragraph's visible text, in order, ignoring deleted revisions. */
export function segments(paragraph: XmlElement, names: Names): Segment[] {
  const found: Segment[] = [];
  let offset = 0;
  const walk = (parent: XmlElement) => {
    for (const child of elementChildren(parent)) {
      if (!child.name.startsWith(`${names.w}:`)) continue;
      const local = localName(child);
      if (local === 'r') {
        for (const node of elementChildren(child)) {
          const text = segmentText(node);
          if (text === null || text.length === 0) continue;
          found.push({ node, run: child, text, start: offset });
          offset += text.length;
        }
      } else if (TEXT_CONTAINERS.has(local)) walk(child);
    }
  };
  walk(paragraph);
  return found;
}

export function paragraphText(paragraph: XmlElement, names: Names): string {
  return segments(paragraph, names)
    .map((segment) => segment.text)
    .join('');
}

function parentOf(root: XmlElement, target: XmlElement): XmlElement | null {
  for (const child of elementChildren(root)) {
    if (child === target) return root;
    const found = parentOf(child, target);
    if (found) return found;
  }
  return null;
}

function textElement(names: Names, text: string): XmlElement {
  const node = element(qualified(names, 't'), { 'xml:space': 'preserve' }, [
    textNode(text),
  ]);
  return stampUnids(node, names);
}

/** Run content for `text`: text, tab and line-break elements. */
function contentNodes(names: Names, text: string): XmlElement[] {
  const nodes: XmlElement[] = [];
  for (const piece of text.split(/(\t|\n)/)) {
    if (piece === '') continue;
    if (piece === '\t')
      nodes.push(stampUnids(element(qualified(names, 'tab')), names));
    else if (piece === '\n')
      nodes.push(stampUnids(element(qualified(names, 'br')), names));
    else nodes.push(textElement(names, piece));
  }
  return nodes;
}

/** Set a text element's content, keeping its id and marking spaces kept. */
function setText(node: XmlElement, text: string) {
  node.children = [textNode(text)];
  setAttribute(node, 'xml:space', 'preserve');
}

function hasContent(run: XmlElement) {
  return elementChildren(run).some((child) => localName(child) !== 'rPr');
}

const PRUNABLE_WRAPPERS = new Set(['hyperlink', 'ins', 'smartTag']);

/** Drop runs an edit emptied, and the wrappers they leave with no runs. */
function prune(paragraph: XmlElement, runs: Set<XmlElement>) {
  for (const run of runs) {
    if (hasContent(run)) continue;
    let node: XmlElement = run;
    let parent = parentOf(paragraph, node);
    while (parent) {
      parent.children = parent.children.filter((child) => child !== node);
      if (
        parent === paragraph ||
        !PRUNABLE_WRAPPERS.has(localName(parent)) ||
        elementChildren(parent).some((child) => localName(child) === 'r')
      )
        break;
      node = parent;
      parent = parentOf(paragraph, node);
    }
  }
}

/** Run properties for new text in an empty paragraph: its mark's formatting. */
function markRunProperties(
  paragraph: XmlElement,
  names: Names
): XmlElement | null {
  const pPr = elementChildren(paragraph).find((child) =>
    isW(child, names, 'pPr')
  );
  const markRPr = pPr && elementChildren(pPr).find((c) => isW(c, names, 'rPr'));
  if (!markRPr) return null;
  const copy = cloneFresh(markRPr, names);
  const revision = new Set(['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange']);
  copy.children = copy.children.filter(
    (child) => !isElement(child) || !revision.has(localName(child))
  );
  return copy;
}

/**
 * Replace the text in [start, end) with `text`. The new text takes the
 * formatting of the run where the range begins; runs, hyperlinks and other
 * inline content outside the range are left exactly as they were.
 */
export function replaceRange(
  paragraph: XmlElement,
  names: Names,
  start: number,
  end: number,
  text: string
) {
  const all = segments(paragraph, names);
  const length = all.reduce((sum, segment) => sum + segment.text.length, 0);
  if (start < 0 || end < start || end > length)
    throw new RangeError(`range ${start}-${end} outside text of ${length}`);
  const replacement = contentNodes(names, text);

  if (all.length === 0) {
    if (replacement.length === 0) return;
    const run = stampUnids(element(qualified(names, 'r')), names);
    const rPr = markRunProperties(paragraph, names);
    run.children = [...(rPr ? [rPr] : []), ...replacement];
    paragraph.children.push(run);
    return;
  }

  // The segment the new text joins: the first one the range touches, or for
  // an insertion the one the position falls in (the last, at the very end).
  const target =
    all.find((segment) =>
      start === end
        ? start < segment.start + segment.text.length
        : start < segment.start + segment.text.length && segment.start < end
    ) ?? all[all.length - 1];
  const touched = new Set<XmlElement>();

  for (const segment of all) {
    const segmentEnd = segment.start + segment.text.length;
    const from = Math.max(start, segment.start) - segment.start;
    const to = Math.min(end, segmentEnd) - segment.start;
    const overlaps = from < to;
    if (segment !== target && !overlaps) continue;
    touched.add(segment.run);
    const siblings = segment.run.children;
    const index = siblings.indexOf(segment.node);

    if (segment !== target) {
      if (localName(segment.node) === 't' && to - from < segment.text.length)
        setText(
          segment.node,
          segment.text.slice(0, from) + segment.text.slice(to)
        );
      else siblings.splice(index, 1);
      continue;
    }

    if (localName(segment.node) !== 't') {
      // A tab or break: replaced when covered, otherwise new text goes after
      // it (an insertion at its end) or before it.
      const after = !overlaps && start >= segmentEnd;
      siblings.splice(
        overlaps ? index : after ? index + 1 : index,
        overlaps ? 1 : 0,
        ...replacement
      );
      continue;
    }

    const prefix = segment.text.slice(0, from);
    const suffix = segment.text.slice(Math.max(to, from));
    const nodes = [...replacement];
    // Merge the kept text into the neighbouring new text where both are text,
    // so a replacement inside one run stays one text element.
    const first = nodes[0];
    if (prefix && first && localName(first) === 't') {
      setText(first, prefix + textContent(first));
    } else if (prefix) nodes.unshift(textElement(names, prefix));
    const last = nodes[nodes.length - 1];
    if (suffix && last && localName(last) === 't') {
      setText(last, textContent(last) + suffix);
    } else if (suffix) nodes.push(textElement(names, suffix));
    // The original element keeps its id by taking the first text's place.
    const firstText = nodes.find((node) => localName(node) === 't');
    if (firstText) {
      setText(segment.node, textContent(firstText));
      nodes[nodes.indexOf(firstText)] = segment.node;
    }
    siblings.splice(index, 1, ...nodes);
  }
  prune(paragraph, touched);
}

/** Split runs so that `offset` falls between two runs. */
function splitAt(paragraph: XmlElement, names: Names, offset: number) {
  const segment = segments(paragraph, names).find(
    (candidate) =>
      candidate.start < offset &&
      offset <= candidate.start + candidate.text.length
  );
  if (!segment) return;
  const { run, node } = segment;
  let splitIndex = run.children.indexOf(node) + 1;
  const local = offset - segment.start;
  if (local < segment.text.length) {
    // Inside a text element: split it in two first.
    const tail = textElement(names, segment.text.slice(local));
    setText(node, segment.text.slice(0, local));
    run.children.splice(splitIndex, 0, tail);
  }
  const content = run.children.slice(splitIndex);
  if (!content.some((child) => isElement(child) && localName(child) !== 'rPr'))
    return;
  const rest = cloneFresh({ ...run, children: [] }, names);
  const rPr = elementChildren(run).find((child) => isW(child, names, 'rPr'));
  rest.children = [...(rPr ? [cloneFresh(rPr, names)] : []), ...content];
  run.children = run.children.slice(0, splitIndex);
  const parent = parentOf(paragraph, run);
  if (!parent) return;
  parent.children.splice(parent.children.indexOf(run) + 1, 0, rest);
}

export type RunFormat = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
};

/** CT_RPr child order; Word rejects run properties out of sequence. */
const RUN_PROPERTY_ORDER = [
  'rStyle',
  'rFonts',
  'b',
  'bCs',
  'i',
  'iCs',
  'caps',
  'smallCaps',
  'strike',
  'dstrike',
  'outline',
  'shadow',
  'emboss',
  'imprint',
  'noProof',
  'snapToGrid',
  'vanish',
  'webHidden',
  'color',
  'spacing',
  'w',
  'kern',
  'position',
  'sz',
  'szCs',
  'highlight',
  'u',
  'effect',
  'bdr',
  'shd',
  'fitText',
  'vertAlign',
  'rtl',
  'cs',
  'em',
  'lang',
  'eastAsianLayout',
  'specVanish',
  'oMath',
  'rPrChange',
];

function setRunProperty(
  rPr: XmlElement,
  names: Names,
  local: string,
  value: string | null
) {
  const val = qualified(names, 'val');
  const existing = elementChildren(rPr).find((child) =>
    isW(child, names, local)
  );
  if (existing) {
    if (value === null) removeAttribute(existing, val);
    else setAttribute(existing, val, value);
    return;
  }
  const next = stampUnids(
    element(qualified(names, local), value === null ? {} : { [val]: value }),
    names
  );
  const rank = RUN_PROPERTY_ORDER.indexOf(local);
  const before = rPr.children.findIndex(
    (child) =>
      isElement(child) && RUN_PROPERTY_ORDER.indexOf(localName(child)) > rank
  );
  if (before < 0) rPr.children.push(next);
  else rPr.children.splice(before, 0, next);
}

function applyFormat(run: XmlElement, names: Names, format: RunFormat) {
  let rPr = elementChildren(run).find((child) => isW(child, names, 'rPr'));
  if (!rPr) {
    rPr = stampUnids(element(qualified(names, 'rPr')), names);
    run.children.unshift(rPr);
  }
  const toggle = (locals: string[], on: boolean | undefined) => {
    if (on === undefined) return;
    for (const local of locals)
      setRunProperty(rPr, names, local, on ? null : '0');
  };
  toggle(['b', 'bCs'], format.bold);
  toggle(['i', 'iCs'], format.italic);
  toggle(['strike'], format.strikethrough);
  if (format.underline !== undefined)
    setRunProperty(rPr, names, 'u', format.underline ? 'single' : 'none');
}

/** Apply character formatting to the text in [start, end). */
export function formatRange(
  paragraph: XmlElement,
  names: Names,
  start: number,
  end: number,
  format: RunFormat
) {
  splitAt(paragraph, names, start);
  splitAt(paragraph, names, end);
  const runs = new Set<XmlElement>();
  for (const segment of segments(paragraph, names))
    if (segment.start >= start && segment.start < end) runs.add(segment.run);
  for (const run of runs) applyFormat(run, names, format);
}

function propertyOn(rPr: XmlElement | undefined, names: Names, local: string) {
  const node = rPr && elementChildren(rPr).find((c) => isW(c, names, local));
  if (!node) return false;
  const value = getAttribute(node, qualified(names, 'val'));
  return value === null || !['0', 'false', 'none', 'off'].includes(value);
}

/** Direct character formatting of a run, as the reader sees it. */
export function runFormat(run: XmlElement, names: Names): RunFormat {
  const rPr = elementChildren(run).find((child) => isW(child, names, 'rPr'));
  return {
    bold: propertyOn(rPr, names, 'b'),
    italic: propertyOn(rPr, names, 'i'),
    underline: propertyOn(rPr, names, 'u'),
    strikethrough: propertyOn(rPr, names, 'strike'),
  };
}

/** The paragraph's properties element, created as its first child if absent. */
export function paragraphProperties(
  paragraph: XmlElement,
  names: Names
): XmlElement {
  const existing = elementChildren(paragraph).find((child) =>
    isW(child, names, 'pPr')
  );
  if (existing) return existing;
  const pPr = stampUnids(element(qualified(names, 'pPr')), names);
  paragraph.children.unshift(pPr);
  return pPr;
}

export function paragraphStyle(
  paragraph: XmlElement,
  names: Names
): string | null {
  const pPr = elementChildren(paragraph).find((c) => isW(c, names, 'pPr'));
  const pStyle =
    pPr && elementChildren(pPr).find((c) => isW(c, names, 'pStyle'));
  return pStyle ? getAttribute(pStyle, qualified(names, 'val')) : null;
}

/** Set (or with null, clear) the paragraph style. `pStyle` comes first. */
export function setParagraphStyle(
  paragraph: XmlElement,
  names: Names,
  styleId: string | null
) {
  const pPr = paragraphProperties(paragraph, names);
  const existing = elementChildren(pPr).find((c) => isW(c, names, 'pStyle'));
  if (styleId === null) {
    if (existing) pPr.children = pPr.children.filter((c) => c !== existing);
    return;
  }
  if (existing) {
    setAttribute(existing, qualified(names, 'val'), styleId);
    return;
  }
  pPr.children.unshift(
    stampUnids(
      element(qualified(names, 'pStyle'), {
        [qualified(names, 'val')]: styleId,
      }),
      names
    )
  );
}

export function paragraphAlignment(
  paragraph: XmlElement,
  names: Names
): string | null {
  const pPr = elementChildren(paragraph).find((c) => isW(c, names, 'pPr'));
  const jc = pPr && elementChildren(pPr).find((c) => isW(c, names, 'jc'));
  return jc ? getAttribute(jc, qualified(names, 'val')) : null;
}

export function isNumbered(paragraph: XmlElement, names: Names): boolean {
  const pPr = elementChildren(paragraph).find((c) => isW(c, names, 'pPr'));
  return !!pPr && elementChildren(pPr).some((c) => isW(c, names, 'numPr'));
}

/**
 * A new paragraph with `text`. `pPr`, when given, is copied (without any
 * section break it carries, which belongs to the original paragraph only).
 */
export function createParagraph(
  names: Names,
  text: string,
  pPr: XmlElement | null
): XmlElement {
  const paragraph = stampUnids(element(qualified(names, 'p')), names);
  if (pPr) {
    const copy = cloneFresh(pPr, names);
    copy.children = copy.children.filter(
      (child) => !isW(child, names, 'sectPr') && !isW(child, names, 'pPrChange')
    );
    paragraph.children.push(copy);
  }
  const content = contentNodes(names, text);
  if (content.length > 0) {
    const run = stampUnids(element(qualified(names, 'r')), names);
    run.children = content;
    paragraph.children.push(run);
  }
  return paragraph;
}
