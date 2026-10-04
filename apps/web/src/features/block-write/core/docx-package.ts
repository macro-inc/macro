import type { DocxPackageState } from '@macro-inc/collaboration/docx/schema';
import { strFromU8, strToU8, unzipSync, type Zippable, zipSync } from 'fflate';

export const DOCUMENT_PART = 'word/document.xml';
const CONTENT_TYPES_PART = '[Content_Types].xml';
/** Where the shell's body content goes when the package is assembled. */
export const BLOCKS_PLACEHOLDER = '<!--macro-docx-blocks-->';
const WORDML_NS =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const POWERTOOLS_NS = 'http://powertools.codeplex.com/2011';
const MARKUP_COMPATIBILITY_NS =
  'http://schemas.openxmlformats.org/markup-compatibility/2006';
const BINARY_PREFIX = 'b64:';

export class DocxPackageError extends Error {}

function isTextPart(name: string): boolean {
  return name === CONTENT_TYPES_PART || /\.(xml|rels)$/i.test(name);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodePart(name: string, bytes: Uint8Array): string {
  return isTextPart(name)
    ? strFromU8(bytes)
    : BINARY_PREFIX + bytesToBase64(bytes);
}

export function decodePart(value: string): Uint8Array {
  return value.startsWith(BINARY_PREFIX)
    ? base64ToBytes(value.slice(BINARY_PREFIX.length))
    : strToU8(value);
}

type StartTag = {
  /** Qualified element name. */
  name: string;
  /** Offset of `<`. */
  start: number;
  /** Offset just past `>`. */
  end: number;
  selfClosing: boolean;
};

/** Offset just past the tag that opens at `start`, honouring quoted attribute values. */
function tagEnd(xml: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < xml.length; i++) {
    const char = xml[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i + 1;
    }
  }
  throw new DocxPackageError('unterminated XML tag');
}

function skipSpecial(xml: string, start: number): number | null {
  if (xml.startsWith('<!--', start)) {
    const end = xml.indexOf('-->', start + 4);
    if (end < 0) throw new DocxPackageError('unterminated XML comment');
    return end + 3;
  }
  if (xml.startsWith('<![CDATA[', start)) {
    const end = xml.indexOf(']]>', start + 9);
    if (end < 0) throw new DocxPackageError('unterminated CDATA section');
    return end + 3;
  }
  if (xml.startsWith('<?', start)) {
    const end = xml.indexOf('?>', start + 2);
    if (end < 0)
      throw new DocxPackageError('unterminated processing instruction');
    return end + 2;
  }
  return null;
}

function readStartTag(xml: string, start: number): StartTag {
  const end = tagEnd(xml, start);
  const match = /^<([^\s/>]+)/.exec(
    xml.slice(start, Math.min(end, start + 256))
  );
  if (!match) throw new DocxPackageError('malformed XML start tag');
  return {
    name: match[1],
    start,
    end,
    selfClosing: xml[end - 2] === '/',
  };
}

/** Offset just past the element whose start tag is `tag`. */
function elementEnd(xml: string, tag: StartTag): number {
  if (tag.selfClosing) return tag.end;
  let depth = 1;
  let i = tag.end;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    const special = skipSpecial(xml, lt);
    if (special !== null) {
      i = special;
      continue;
    }
    const end = tagEnd(xml, lt);
    if (xml[lt + 1] === '/') {
      depth--;
      if (depth === 0) return end;
    } else if (xml[end - 2] !== '/') {
      depth++;
    }
    i = end;
  }
  throw new DocxPackageError(`unterminated <${tag.name}> element`);
}

/** Namespace declarations made by one start tag (prefix → uri; '' is the default namespace). */
function declarations(startTag: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of startTag.matchAll(
    /\sxmlns(?::([\w.-]+))?\s*=\s*"([^"]*)"/g
  ))
    found.set(match[1] ?? '', match[2]);
  return found;
}

function attribute(startTag: string, qualifiedName: string): string | null {
  const escaped = qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\s${escaped}\\s*=\\s*"([^"]*)"`).exec(startTag);
  return match ? match[1] : null;
}

function prefixFor(scope: Map<string, string>, uri: string): string | null {
  for (const [prefix, value] of scope)
    if (value === uri && prefix) return prefix;
  return null;
}

/** Prefixes an element's markup uses, including those named by mc:Ignorable-style attributes. */
function usedPrefixes(xml: string, mcPrefix: string | null): Set<string> {
  const used = new Set<string>();
  for (const match of xml.matchAll(/<\/?([A-Za-z_][\w.-]*):/g))
    used.add(match[1]);
  for (const match of xml.matchAll(
    /\s([A-Za-z_][\w.-]*):[A-Za-z_][\w.-]*\s*=/g
  ))
    used.add(match[1]);
  if (mcPrefix) {
    const listed = new RegExp(
      `\\s${mcPrefix}:(?:Ignorable|ProcessContent|MustUnderstand|PreserveElements|PreserveAttributes)\\s*=\\s*"([^"]*)"`,
      'g'
    );
    for (const match of xml.matchAll(listed))
      for (const token of match[1].split(/\s+/)) {
        const prefix = token.split(':')[0];
        if (prefix) used.add(prefix);
      }
  }
  used.delete('xmlns');
  used.delete('xml');
  return used;
}

/**
 * Make an element extracted from its document self-describing: declare every
 * namespace prefix it uses that an ancestor declared. Raw engine operations
 * parse a block on its own, outside the document it came from.
 */
function standalone(
  xml: string,
  tag: StartTag,
  scope: Map<string, string>,
  mcPrefix: string | null
): string {
  const startTag = xml.slice(0, tag.end - tag.start);
  const own = declarations(startTag);
  const missing: string[] = [];
  for (const prefix of usedPrefixes(xml, mcPrefix)) {
    if (own.has(prefix)) continue;
    const uri = scope.get(prefix);
    if (uri !== undefined) missing.push(` xmlns:${prefix}="${uri}"`);
  }
  if (missing.length === 0) return xml;
  const insertAt = tag.name.length + 1;
  return xml.slice(0, insertAt) + missing.sort().join('') + xml.slice(insertAt);
}

export type SplitDocument = {
  shell: string;
  order: string[];
  blocks: Map<string, string>;
};

/**
 * Split `word/document.xml` into its top-level body elements and a shell that
 * keeps everything else (root, namespaces, final section properties).
 */
export function splitDocumentXml(xml: string): SplitDocument {
  let i = 0;
  let root: StartTag | null = null;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    const special = skipSpecial(xml, lt);
    if (special !== null) {
      i = special;
      continue;
    }
    root = readStartTag(xml, lt);
    break;
  }
  if (!root) throw new DocxPackageError('document part has no root element');
  const scope = declarations(xml.slice(root.start, root.end));
  const w = prefixFor(scope, WORDML_NS);
  if (!w) throw new DocxPackageError('document part is not WordprocessingML');

  const bodyName = `${w}:body`;
  let body: StartTag | null = null;
  i = root.end;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    const special = skipSpecial(xml, lt);
    if (special !== null) {
      i = special;
      continue;
    }
    if (xml[lt + 1] === '/') break;
    const tag = readStartTag(xml, lt);
    if (tag.name === bodyName) {
      body = tag;
      break;
    }
    i = elementEnd(xml, tag);
  }
  if (!body) throw new DocxPackageError('document part has no body');
  if (body.selfClosing) {
    return {
      shell:
        xml.slice(0, body.end - 2) +
        `>${BLOCKS_PLACEHOLDER}</${bodyName}>` +
        xml.slice(body.end),
      order: [],
      blocks: new Map(),
    };
  }
  for (const [prefix, uri] of declarations(xml.slice(body.start, body.end)))
    scope.set(prefix, uri);
  const unidPrefix = prefixFor(scope, POWERTOOLS_NS);
  const mcPrefix = prefixFor(scope, MARKUP_COMPATIBILITY_NS);

  type Child = { tag: StartTag; end: number };
  const children: Child[] = [];
  let bodyClose = -1;
  i = body.end;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    const special = skipSpecial(xml, lt);
    if (special !== null) {
      i = special;
      continue;
    }
    if (xml[lt + 1] === '/') {
      bodyClose = lt;
      break;
    }
    const tag = readStartTag(xml, lt);
    const end = elementEnd(xml, tag);
    children.push({ tag, end });
    i = end;
  }
  if (bodyClose < 0) throw new DocxPackageError('unterminated document body');

  // The body's final sectPr describes the last section; it belongs to the shell.
  const last = children.at(-1);
  const finalSection =
    last && last.tag.name === `${w}:sectPr` ? children.pop() : undefined;

  const order: string[] = [];
  const blocks = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const child of children) {
    const element = xml.slice(child.tag.start, child.end);
    const startTag = xml.slice(child.tag.start, child.tag.end);
    let id = unidPrefix ? attribute(startTag, `${unidPrefix}:Unid`) : null;
    if (!id) {
      // Every element the engine saves carries an id; fall back to a content
      // address so a foreign package still splits deterministically.
      const base = `x${fnv1a(element)}`;
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      id = count ? `${base}-${count}` : base;
    }
    if (blocks.has(id))
      throw new DocxPackageError(`duplicate block id ${id} in document body`);
    order.push(id);
    blocks.set(id, standalone(element, child.tag, scope, mcPrefix));
  }

  const tail = finalSection
    ? xml.slice(finalSection.tag.start, finalSection.end)
    : '';
  const shell =
    xml.slice(0, body.end) + BLOCKS_PLACEHOLDER + tail + xml.slice(bodyClose);
  return { shell, order, blocks };
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Read an engine snapshot (saved with anchor ids) into collaboration state. */
export function splitPackage(bytes: Uint8Array): DocxPackageState {
  const files = unzipSync(bytes);
  const document = files[DOCUMENT_PART];
  if (!document) throw new DocxPackageError('package has no word/document.xml');
  const split = splitDocumentXml(strFromU8(document));
  const parts = new Map<string, string>();
  for (const [name, content] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    parts.set(
      name,
      name === DOCUMENT_PART ? split.shell : encodePart(name, content)
    );
  }
  return { order: split.order, blocks: split.blocks, parts };
}

/** The document part for `state`: its shell with the ordered blocks in the body. */
export function assembleDocumentXml(state: DocxPackageState): string {
  const shell = state.parts.get(DOCUMENT_PART);
  if (shell === undefined || !shell.includes(BLOCKS_PLACEHOLDER))
    throw new DocxPackageError('collaboration state has no document shell');
  const body = state.order.map((id) => state.blocks.get(id) ?? '').join('');
  return shell.replace(BLOCKS_PLACEHOLDER, () => body);
}

/** Build an openable package from collaboration state. */
export function assemblePackage(state: DocxPackageState): Uint8Array {
  const files: Zippable = {};
  const contentTypes = state.parts.get(CONTENT_TYPES_PART);
  if (contentTypes !== undefined)
    files[CONTENT_TYPES_PART] = strToU8(contentTypes);
  for (const [name, value] of state.parts) {
    if (name === CONTENT_TYPES_PART) continue;
    files[name] =
      name === DOCUMENT_PART
        ? strToU8(assembleDocumentXml(state))
        : decodePart(value);
  }
  // Stored, not deflated: the package is opened in-process immediately.
  return zipSync(files, { level: 0 });
}
