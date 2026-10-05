import { type LoroDoc, LoroMap, LoroText } from 'loro-crdt';
import {
  DocxAgentError,
  type DocxAgentOperation,
  MAX_DOCX_OPERATIONS,
  occurrences,
  preview,
  READ_BUDGET,
} from './agent-types';
import { keysBetween } from './fractional-index';
import {
  findStyle,
  type ParagraphStyleInfo,
  paragraphStylesFromXml,
} from './styles';

/**
 * AI tool requests on a Word document in the shared format the DOCX engine
 * writes (format version 2): every block is a map in `wordBlocks` (`k`
 * kind, `p` parent, `o` position key, `x` properties as XML) and every
 * paragraph's text is rich text whose marks are its formatting (`r:w:b` →
 * `<w:b/>`, ...). Edits land as ordinary CRDT operations, so open editors
 * patch them in and concurrent typing elsewhere merges.
 */

/** Containers of the shared format. */
export const WORD_CONTAINERS = {
  meta: 'docxMeta',
  parts: 'wordParts',
  blocks: 'wordBlocks',
} as const;

export const WORD_FORMAT_VERSION = 2;

/** Stands in for objects (pictures, fields, note references) in the text. */
const OBJECT = '￼';
const WORDML_NS =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

type Attributes = Record<string, string>;
type Span = { insert: string; attributes?: Attributes };

/** One block of the body as stored. */
export type WordBlock = {
  id: string;
  kind: string;
  parent: string;
  key: string;
  props: string;
  map: LoroMap;
};

/** A paragraph's text as a reader sees it, with where each character is. */
type Visible = {
  text: string;
  /** Index in the stored text of each visible character. */
  at: number[];
  /** Attributes of each visible character. */
  attrs: Attributes[];
};

function field(map: LoroMap, key: string): string {
  const value = map.get(key);
  return typeof value === 'string' ? value : '';
}

/** Text that is not part of what a paragraph says: field codes, deleted
 * text and markers between runs. */
function hidden(attrs: Attributes): boolean {
  if ('instr' in attrs || 'mark' in attrs || 'obj' in attrs) return true;
  const wrap = attrs.wrap;
  return !!wrap && /<[\w]*:?del[\s>/]|<[\w]*:?moveFrom[\s>/]/.test(wrap);
}

/** Whether a run property mark turns its toggle on (`<w:b/>`, not `w:val="0"`). */
function on(xml: string | undefined): boolean {
  if (!xml) return false;
  const val = /:val="([^"]*)"/.exec(xml)?.[1];
  return val === undefined || !['0', 'false', 'off', 'none'].includes(val);
}

/** The document's shared copy, read for an agent. */
export class WordDocument {
  readonly blocks = new Map<string, WordBlock>();
  private readonly children = new Map<string, WordBlock[]>();
  /** The prefix the document binds to WordprocessingML. */
  readonly w: string;

  constructor(readonly doc: LoroDoc) {
    doc.configDefaultTextStyle({ expand: 'none' });
    const map = doc.getMap(WORD_CONTAINERS.blocks);
    for (const id of map.keys()) {
      const value = map.get(id);
      if (!(value instanceof LoroMap)) continue;
      const kind = field(value, 'k');
      if (!kind) continue;
      this.blocks.set(id, {
        id,
        kind,
        parent: field(value, 'p'),
        key: field(value, 'o'),
        props: field(value, 'x'),
        map: value,
      });
    }
    this.reindex();
    this.w = this.prefix();
  }

  private reindex() {
    this.children.clear();
    for (const block of this.blocks.values()) {
      // Blocks whose parent is gone (a concurrent delete) are not shown.
      if (block.parent && !this.blocks.has(block.parent)) continue;
      const list = this.children.get(block.parent) ?? [];
      list.push(block);
      this.children.set(block.parent, list);
    }
    for (const list of this.children.values())
      list.sort((a, b) =>
        a.key < b.key ? -1 : a.key > b.key ? 1 : a.id < b.id ? -1 : 1
      );
  }

  private prefix(): string {
    const parts = this.doc.getMap(WORD_CONTAINERS.parts);
    for (const name of parts.keys()) {
      if (!name.endsWith('document.xml') && !name.endsWith('document2.xml'))
        continue;
      const shell = parts.get(name);
      if (typeof shell !== 'string') continue;
      const match = new RegExp(
        `xmlns:(\\w+)="${WORDML_NS.replace(/[./]/g, '\\$&')}"`
      ).exec(shell);
      if (match) return match[1];
    }
    return 'w';
  }

  /** Children of a block (`''` for the body), in order. */
  kids(parent: string): WordBlock[] {
    return this.children.get(parent) ?? [];
  }

  /** A part's text by name (with or without the leading slash). */
  part(name: string): string | undefined {
    const parts = this.doc.getMap(WORD_CONTAINERS.parts);
    const value = parts.get(`/${name}`) ?? parts.get(name);
    return typeof value === 'string' ? value : undefined;
  }

  text(block: WordBlock): LoroText {
    const value = block.map.get('t');
    if (value instanceof LoroText) return value;
    return block.map.setContainer('t', new LoroText());
  }

  spans(block: WordBlock): Span[] {
    return this.text(block).toDelta() as Span[];
  }

  visible(block: WordBlock): Visible {
    const out: Visible = { text: '', at: [], attrs: [] };
    let index = 0;
    for (const span of this.spans(block)) {
      const attrs = span.attributes ?? {};
      const skip = hidden(attrs);
      for (const unit of span.insert) {
        // Code units, as the shared text counts them.
        for (let i = 0; i < unit.length; i++) {
          if (!skip && unit !== OBJECT) {
            out.text += unit[i];
            out.at.push(index);
            out.attrs.push(attrs);
          }
          index++;
        }
      }
    }
    return out;
  }

  /** The value of a property child (`pStyle`, `jc`...) of a block's XML. */
  propVal(block: WordBlock, local: string): string | null {
    const re = new RegExp(
      `<${this.w}:${local}\\b[^>]*\\b${this.w}:val="([^"]*)"`
    );
    return re.exec(block.props)?.[1] ?? null;
  }

  hasProp(block: WordBlock, local: string): boolean {
    return new RegExp(`<${this.w}:${local}[\\s>/]`).test(block.props);
  }

  /** Removes a block and everything in it. */
  remove(block: WordBlock) {
    const map = this.doc.getMap(WORD_CONTAINERS.blocks);
    const walk = (b: WordBlock) => {
      for (const kid of this.kids(b.id)) walk(kid);
      map.delete(b.id);
      this.blocks.delete(b.id);
    };
    walk(block);
    this.reindex();
  }

  /** Adds a paragraph next to `anchor`. */
  addParagraph(
    anchor: WordBlock,
    after: boolean,
    props: string,
    spans: Span[]
  ): WordBlock {
    const siblings = this.kids(anchor.parent);
    const index = siblings.indexOf(anchor);
    const low = after ? anchor.key : (siblings[index - 1]?.key ?? null);
    const high = after ? (siblings[index + 1]?.key ?? null) : anchor.key;
    const [key] = keysBetween(low || null, high || null, 1);
    const id = newBlockId();
    const map = this.doc
      .getMap(WORD_CONTAINERS.blocks)
      .setContainer(id, new LoroMap());
    map.set('k', 'p');
    map.set('p', anchor.parent);
    map.set('o', key);
    map.set('a', '');
    map.set('x', props);
    const text = map.setContainer('t', new LoroText());
    if (spans.length) text.applyDelta(spans);
    const block: WordBlock = {
      id,
      kind: 'p',
      parent: anchor.parent,
      key,
      props,
      map,
    };
    this.blocks.set(id, block);
    this.reindex();
    return block;
  }

  setProps(block: WordBlock, props: string) {
    block.map.set('x', props);
    block.props = props;
  }
}

/** A fresh block id in the engine's style (base 36), unlikely to collide. */
function newBlockId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return `g${n.toString(36)}`;
}

/** Whether the document is in the engine's shared format. */
export function isWordFormat(doc: LoroDoc): boolean {
  return (
    doc.getMap(WORD_CONTAINERS.meta).get('formatVersion') ===
    WORD_FORMAT_VERSION
  );
}

/** The run formatting an agent can change, as mark keys and values. */
export function formatMarks(
  w: string,
  format: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
  }
): Attributes {
  const marks: Attributes = {};
  const flag = (local: string, value: boolean | undefined) => {
    if (value === undefined) return;
    marks[`r:${w}:${local}`] = value
      ? `<${w}:${local}/>`
      : `<${w}:${local} ${w}:val="0"/>`;
  };
  flag('b', format.bold);
  flag('i', format.italic);
  flag('strike', format.strikethrough);
  if (format.underline !== undefined)
    marks[`r:${w}:u`] =
      `<${w}:u ${w}:val="${format.underline ? 'single' : 'none'}"/>`;
  return marks;
}

/** Which of the four toggles a character's marks turn on. */
export function formatOf(w: string, attrs: Attributes) {
  return {
    bold: on(attrs[`r:${w}:b`]),
    italic: on(attrs[`r:${w}:i`]),
    underline: on(attrs[`r:${w}:u`]),
    strikethrough: on(attrs[`r:${w}:strike`]),
  };
}

/** The formatting text typed in place of other text takes: its run
 * properties and wrappers, not object or marker keys. */
export function typingAttributes(attrs: Attributes | undefined): Attributes {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(attrs ?? {}))
    if (key.startsWith('r:') || key.startsWith('ra:') || key === 'wrap')
      out[key] = value;
  return out;
}

const quote = (text: string) => `"${preview(text, 60)}"`;
const KINDS = ['bold', 'italic', 'underline', 'strikethrough'] as const;

/** Formatted spans worth telling a reader about, e.g. `bold: "Agreement"`. */
function formattingNotes(word: WordDocument, visible: Visible): string[] {
  const spans: Record<(typeof KINDS)[number], string[]> = {
    bold: [],
    italic: [],
    underline: [],
    strikethrough: [],
  };
  const open: Partial<Record<(typeof KINDS)[number], string>> = {};
  const n = visible.text.length;
  for (let i = 0; i < n; i++) {
    const format = formatOf(word.w, visible.attrs[i]);
    for (const kind of KINDS) {
      if (format[kind]) open[kind] = (open[kind] ?? '') + visible.text[i];
      if ((!format[kind] || i === n - 1) && open[kind]) {
        if (open[kind]!.trim()) spans[kind].push(open[kind]!);
        open[kind] = undefined;
      }
    }
  }
  return KINDS.flatMap((kind) => {
    const list = spans[kind];
    if (list.length === 0) return [];
    if (list.length === 1 && list[0] === visible.text) return [`${kind}: all`];
    const shown = list.slice(0, 6).map(quote).join(', ');
    return [`${kind}: ${shown}${list.length > 6 ? ', …' : ''}`];
  });
}

function paragraphLines(
  word: WordDocument,
  block: WordBlock,
  label: string,
  indent: string
): string[] {
  const traits = [
    word.propVal(block, 'pStyle'),
    word.propVal(block, 'jc'),
    word.hasProp(block, 'numPr') ? 'numbered' : null,
  ].filter(Boolean);
  const visible = word.visible(block);
  const text = visible.text.replace(/\n/g, '↵');
  const head = `${indent}${label}paragraph ${block.id}${traits.length ? ` (${traits.join(', ')})` : ''}`;
  if (!text) return [`${head} (empty)`];
  return [
    head,
    `${indent}  ${text}`,
    ...formattingNotes(word, visible).map((note) => `${indent}  ${note}`),
  ];
}

function contentLines(
  word: WordDocument,
  parent: string,
  indent: string
): string[] {
  return word
    .kids(parent)
    .flatMap((block) => blockLines(word, block, '', indent));
}

function blockLines(
  word: WordDocument,
  block: WordBlock,
  label: string,
  indent: string
): string[] {
  switch (block.kind) {
    case 'p':
      return paragraphLines(word, block, label, indent);
    case 'tbl': {
      const rows = word.kids(block.id).filter((r) => r.kind === 'tr');
      const columns = Math.max(
        0,
        ...rows.map(
          (r) => word.kids(r.id).filter((c) => c.kind === 'tc').length
        )
      );
      const lines = [
        `${indent}${label}table ${block.id}, ${rows.length} rows x ${columns} columns`,
      ];
      rows.forEach((row, r) => {
        word
          .kids(row.id)
          .filter((c) => c.kind === 'tc')
          .forEach((cell, c) => {
            lines.push(`${indent}  row ${r + 1}, cell ${c + 1}:`);
            lines.push(...contentLines(word, cell.id, `${indent}    `));
          });
      });
      return lines;
    }
    case 'sdt': {
      const title =
        /:(?:alias|tag|docPartGallery)\b[^>]*:val="([^"]*)"/.exec(
          block.props
        )?.[1] ?? null;
      return [
        `${indent}${label}content control ${block.id}${title ? ` (${title})` : ''}`,
        ...contentLines(word, block.id, `${indent}  `),
      ];
    }
    default:
      // Bookmarks and other markers between paragraphs carry no content.
      return [];
  }
}

function styles(word: WordDocument): ParagraphStyleInfo[] {
  return paragraphStylesFromXml(word.part('word/styles.xml'));
}

/** The document as text an agent can act on: every block with its id. */
export function describeWord(
  doc: LoroDoc,
  options: { start?: number; count?: number } = {}
): string {
  const word = new WordDocument(doc);
  const top = word.kids('');
  const start = Math.max(1, Math.floor(options.start ?? 1));
  const end = Math.min(
    top.length,
    options.count
      ? start - 1 + Math.max(1, Math.floor(options.count))
      : Infinity
  );
  const all = styles(word);
  const used = new Set<string>();
  const body: string[] = [];
  let size = 0;
  let next: number | null = null;
  for (let number = start; number <= end; number++) {
    const block = top[number - 1];
    const lines = blockLines(word, block, `#${number} `, '');
    const length = lines.reduce((sum, line) => sum + line.length + 1, 0);
    if (size + length > READ_BUDGET && body.length > 0) {
      next = number;
      break;
    }
    size += length;
    body.push(...lines);
    for (const line of lines) {
      const style = /^\s*(?:#\d+ )?paragraph \S+ \(([^,)]+)/.exec(line)?.[1];
      if (style) used.add(style);
    }
  }
  const styleList = [
    ...all.filter((s) => used.has(s.id)),
    ...all.filter((s) => !used.has(s.id)),
  ]
    .slice(0, 40)
    .map((s) => s.id);
  const header = [
    `Word document with ${top.length} blocks${start > 1 || end < top.length ? `; showing #${start}-#${next ? next - 1 : end}` : ''}.`,
    'Ids are stable: pass them to EditWordDocument. Text is shown plain; lines like `bold: "..."` list formatted spans. ↵ is a line break inside a paragraph.',
    ...(styleList.length
      ? [
          `Paragraph styles: ${styleList.join(', ')}${all.length > 40 ? ', …' : ''}.`,
        ]
      : []),
    '',
  ];
  const footer = next
    ? [
        '',
        `… ${top.length - next + 1} more blocks. Read again with start=${next} to continue.`,
      ]
    : [];
  return [...header, ...body, ...footer].join('\n');
}

/** The top-level block holding a block. */
function topOf(word: WordDocument, block: WordBlock): WordBlock {
  let at = block;
  while (at.parent) {
    const parent = word.blocks.get(at.parent);
    if (!parent) break;
    at = parent;
  }
  return at;
}

/** Paragraph properties without what belongs to that paragraph alone: its
 * section break and recorded changes. */
function copiedProps(props: string): string {
  return props
    .replace(/<(\w+:)?sectPr\b[\s\S]*?<\/\1?sectPr>/g, '')
    .replace(/<(\w+:)?sectPr\b[^>]*\/>/g, '')
    .replace(/<(\w+:)?pPrChange\b[\s\S]*?<\/\1?pPrChange>/g, '')
    .replace(/<(\w+:)?(ins|del)\b[^>]*\/>/g, '');
}

/** `w:pPr` XML naming a style, from a paragraph's properties. */
function withStyle(w: string, props: string, style: string): string {
  const tag = `<${w}:pStyle ${w}:val="${style}"/>`;
  if (!props.trim()) return `<${w}:pPr>${tag}</${w}:pPr>`;
  if (new RegExp(`<${w}:pStyle\\b`).test(props))
    return props.replace(new RegExp(`<${w}:pStyle\\b[^>]*/>`), tag);
  if (/\/>\s*$/.test(props) && !props.includes('</'))
    return props.replace(/\s*\/>\s*$/, `>${tag}</${w}:pPr>`);
  // pStyle is the first property in schema order.
  return props.replace(/^(\s*<[^>]+>)/, `$1${tag}`);
}

class WordEditor {
  readonly touched = new Set<string>();
  readonly deleted: string[] = [];
  private readonly styles: ParagraphStyleInfo[];

  constructor(readonly word: WordDocument) {
    this.styles = styles(word);
  }

  private block(id: string): WordBlock {
    const found = this.word.blocks.get(id);
    if (!found)
      throw new DocxAgentError(
        `No paragraph or block has id ${id}. Read the document again for current ids.`
      );
    return found;
  }

  private paragraph(id: string): WordBlock {
    const found = this.block(id);
    if (found.kind !== 'p')
      throw new DocxAgentError(
        `${id} is a ${describeKind(found.kind)}, not a paragraph. Address the paragraphs inside it.`
      );
    return found;
  }

  private changed(block: WordBlock) {
    this.touched.add(topOf(this.word, block).id);
  }

  /** The visible range `[start, end)` an operation addresses. */
  private range(
    block: WordBlock,
    visible: Visible,
    find: string | undefined,
    occurrence: number | undefined
  ): [number, number] {
    const text = visible.text;
    if (find === undefined) return [0, text.length];
    const matches = occurrences(text, find);
    if (matches.length === 0)
      throw new DocxAgentError(
        `"${preview(find, 80)}" does not appear in paragraph ${block.id}, whose text is: "${preview(text)}"`
      );
    if (occurrence === undefined && matches.length > 1)
      throw new DocxAgentError(
        `"${preview(find, 80)}" appears ${matches.length} times in paragraph ${block.id}; pass occurrence (1-${matches.length}) or a longer find.`
      );
    const index = (occurrence ?? 1) - 1;
    if (index < 0 || index >= matches.length)
      throw new DocxAgentError(
        `Paragraph ${block.id} has ${matches.length} occurrence(s) of "${preview(find, 80)}"; occurrence ${occurrence} is out of range.`
      );
    return [matches[index], matches[index] + find.length];
  }

  /** Stored offsets of a visible range (hidden text inside it goes too). */
  private stored(
    visible: Visible,
    start: number,
    end: number
  ): [number, number] {
    if (start === end) {
      const at =
        start < visible.at.length
          ? visible.at[start]
          : (visible.at[visible.at.length - 1] ?? -1) + 1;
      return [at, at];
    }
    return [visible.at[start], visible.at[end - 1] + 1];
  }

  /** Replaces visible text `[start, end)` with `text`, formatted like the
   * text it replaces (or the text before it). */
  private replace(block: WordBlock, start: number, end: number, text: string) {
    const visible = this.word.visible(block);
    const [from, to] = this.stored(visible, start, end);
    const like = visible.attrs[start] ?? visible.attrs[start - 1];
    const delta: Array<Record<string, unknown>> = [];
    if (from > 0) delta.push({ retain: from });
    if (to > from) delta.push({ delete: to - from });
    if (text) {
      const attributes = typingAttributes(like);
      delta.push(
        Object.keys(attributes).length
          ? { insert: text, attributes }
          : { insert: text }
      );
    }
    if (delta.length) this.word.text(block).applyDelta(delta as never);
    this.changed(block);
  }

  private static singleLine(text: string, what: string) {
    if (/[\r\n]/.test(text))
      throw new DocxAgentError(
        `${what} cannot contain a line break; use insertParagraph to add paragraphs.`
      );
  }

  private resolveStyle(style: string): string {
    const found = findStyle(this.styles, style);
    if (!found)
      throw new DocxAgentError(
        `The document has no paragraph style "${style}". Its paragraph styles are: ${this.styles
          .map((s) => s.id)
          .join(', ')}.`
      );
    return found;
  }

  apply(operation: DocxAgentOperation) {
    switch (operation.type) {
      case 'replaceText': {
        WordEditor.singleLine(operation.replace, 'replace');
        if (!operation.find)
          throw new DocxAgentError('find must not be empty.');
        const block = this.paragraph(operation.paragraph);
        const visible = this.word.visible(block);
        const [start, end] = this.range(
          block,
          visible,
          operation.find,
          operation.occurrence
        );
        this.replace(block, start, end, operation.replace);
        return;
      }
      case 'setText': {
        WordEditor.singleLine(operation.text, 'text');
        const block = this.paragraph(operation.paragraph);
        const visible = this.word.visible(block);
        this.replace(block, 0, visible.text.length, operation.text);
        return;
      }
      case 'formatText': {
        const { bold, italic, underline, strikethrough } = operation;
        if (
          [bold, italic, underline, strikethrough].every((v) => v === undefined)
        )
          throw new DocxAgentError(
            'formatText needs at least one of bold, italic, underline or strikethrough.'
          );
        const block = this.paragraph(operation.paragraph);
        const visible = this.word.visible(block);
        const [start, end] = this.range(
          block,
          visible,
          operation.find,
          operation.occurrence
        );
        if (start === end) return;
        const [from, to] = this.stored(visible, start, end);
        const attributes = formatMarks(this.word.w, {
          bold,
          italic,
          underline,
          strikethrough,
        });
        const delta: Array<Record<string, unknown>> = [];
        if (from > 0) delta.push({ retain: from });
        delta.push({ retain: to - from, attributes });
        this.word.text(block).applyDelta(delta as never);
        this.changed(block);
        return;
      }
      case 'insertParagraph':
        this.insert(operation);
        return;
      case 'delete':
        this.delete(operation.id);
        return;
      case 'setStyle': {
        const block = this.paragraph(operation.paragraph);
        const style = this.resolveStyle(operation.style);
        this.word.setProps(block, withStyle(this.word.w, block.props, style));
        this.changed(block);
        return;
      }
    }
  }

  /** Paragraph properties for a paragraph added next to `anchor`. */
  private newProps(anchor: WordBlock, style: string | undefined): string {
    const w = this.word.w;
    if (style !== undefined) return withStyle(w, '', this.resolveStyle(style));
    if (anchor.kind !== 'p') return '';
    // As Word does on Enter: a style that names a different next style (a
    // heading, say) is followed by that style; any other paragraph is copied.
    const current = this.word.propVal(anchor, 'pStyle');
    const info = current
      ? this.styles.find((s) => s.id === current)
      : undefined;
    if (info?.next && info.next !== info.id) {
      const next = this.styles.find((s) => s.id === info.next);
      return next?.isDefault ? '' : withStyle(w, '', info.next);
    }
    return copiedProps(anchor.props);
  }

  private insert(
    operation: Extract<DocxAgentOperation, { type: 'insertParagraph' }>
  ) {
    const anchorId = operation.after ?? operation.before;
    if (!anchorId || (operation.after && operation.before))
      throw new DocxAgentError(
        'insertParagraph needs exactly one of after or before.'
      );
    const anchor = this.block(anchorId);
    if (anchor.kind === 'tr' || anchor.kind === 'tc')
      throw new DocxAgentError(
        `${anchorId} is a table ${anchor.kind === 'tr' ? 'row' : 'cell'}; insert next to a paragraph or the table instead.`
      );
    const props = this.newProps(anchor, operation.style);
    // New text is formatted like the anchor's first character.
    const like =
      anchor.kind === 'p' && operation.style === undefined
        ? typingAttributes(this.word.visible(anchor).attrs[0])
        : {};
    const lines = operation.text.replace(/\r\n?/g, '\n').split('\n');
    const after = operation.after !== undefined;
    let at = anchor;
    const ordered = after ? lines : [...lines].reverse();
    for (const line of ordered) {
      const spans = line
        ? [
            Object.keys(like).length
              ? { insert: line, attributes: like }
              : { insert: line },
          ]
        : [];
      at = this.word.addParagraph(at, after, props, spans);
      this.changed(at);
    }
  }

  private delete(id: string) {
    const block = this.block(id);
    if (!block.parent) {
      if (this.word.kids('').length === 1)
        throw new DocxAgentError(
          'The document must keep at least one block; use setText to clear it instead.'
        );
      this.word.remove(block);
      this.touched.delete(block.id);
      this.deleted.push(block.id);
      return;
    }
    const parent = this.word.blocks.get(block.parent);
    if (
      parent?.kind === 'tc' &&
      !this.word
        .kids(parent.id)
        .some((b) => b.id !== block.id && (b.kind === 'p' || b.kind === 'tbl'))
    )
      throw new DocxAgentError(
        `Paragraph ${id} is the only paragraph in its table cell; use setText with empty text to clear it.`
      );
    const top = topOf(this.word, block);
    this.word.remove(block);
    this.touched.add(top.id);
  }
}

function describeKind(kind: string): string {
  switch (kind) {
    case 'tbl':
      return 'table';
    case 'tr':
      return 'table row';
    case 'tc':
      return 'table cell';
    case 'sdt':
      return 'content control';
    default:
      return 'block';
  }
}

/**
 * Applies `operations` to the shared document in one commit and describes
 * the blocks they changed. Any failure throws before anything is committed;
 * the caller drops the document then, so nothing reaches anyone.
 */
export function editWord(
  doc: LoroDoc,
  operations: readonly DocxAgentOperation[]
): string {
  if (operations.length === 0 || operations.length > MAX_DOCX_OPERATIONS)
    throw new DocxAgentError(
      `Send between 1 and ${MAX_DOCX_OPERATIONS} operations.`
    );
  const editor = new WordEditor(new WordDocument(doc));
  operations.forEach((operation, index) => {
    try {
      editor.apply(operation);
    } catch (error) {
      if (error instanceof DocxAgentError)
        throw new DocxAgentError(
          `Operation ${index + 1} (${operation.type}) failed, so nothing was changed: ${error.message}`
        );
      throw error;
    }
  });
  doc.commit({ origin: 'docx-agent' });
  // How the changed blocks read now, for the agent to check.
  const word = new WordDocument(doc);
  const top = word.kids('');
  const count = operations.length;
  const lines = [
    `Applied ${count} operation${count === 1 ? '' : 's'}. Everyone with the document open sees the change now.`,
  ];
  if (editor.deleted.length)
    lines.push(`Deleted blocks: ${editor.deleted.join(', ')}.`);
  const touched = top.filter((b) => editor.touched.has(b.id));
  if (touched.length) {
    lines.push('', 'Changed blocks as they now read:');
    let size = 0;
    for (const block of touched) {
      const shown = blockLines(word, block, `#${top.indexOf(block) + 1} `, '');
      size += shown.join('\n').length;
      if (size > READ_BUDGET) {
        lines.push('… (more changed blocks; read the document to see them)');
        break;
      }
      lines.push(...shown);
    }
  }
  return lines.join('\n');
}
