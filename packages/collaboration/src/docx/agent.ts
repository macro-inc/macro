import { LoroDoc } from 'loro-crdt';
import type { ResultAsync } from 'neverthrow';
import type {
  InitialSync,
  LiveSyncSource,
  TimeoutError,
} from '../collab/source';
import {
  DocxAgentError,
  type DocxAgentOperation,
  type DocxAgentRequest,
  type DocxAgentResult,
  MAX_DOCX_OPERATIONS,
  occurrences,
  preview,
  READ_BUDGET,
} from './agent-types';
import {
  createParagraph,
  formatRange,
  isNumbered,
  isW,
  localName,
  type Names,
  newUnid,
  POWERTOOLS_NS,
  paragraphAlignment,
  paragraphStyle,
  paragraphText,
  replaceRange,
  runFormat,
  segments,
  setParagraphStyle,
  unidOf,
  WORDML_NS,
} from './paragraph';
import { tracksRevisions } from './revisions';
import {
  type DocxPackageState,
  diffDocxStates,
  isDocxSeeded,
  readDocxState,
  writeDocxChanges,
} from './schema';
import {
  findStyle,
  type ParagraphStyleInfo,
  paragraphStylesFromXml,
  prefixFor,
} from './styles';
import { describeWord, editWord, isWordFormat } from './word-agent';
import {
  elementChildren,
  getAttribute,
  parseElement,
  serializeXml,
  setAttribute,
  type XmlElement,
} from './xml';

export {
  DocxAgentError,
  type DocxAgentOperation,
  type DocxAgentRequest,
  type DocxAgentResult,
  MAX_DOCX_OPERATIONS,
} from './agent-types';

const STYLES_PART = 'word/styles.xml';

/** Paragraph styles the document defines, in definition order. */
export function paragraphStyles(state: DocxPackageState): ParagraphStyleInfo[] {
  return paragraphStylesFromXml(state.parts.get(STYLES_PART));
}

type Tree = { root: XmlElement; names: Names };
type Located = {
  block: string;
  node: XmlElement;
  parent: XmlElement | null;
  names: Names;
};

/** A mutable working copy of the document body, parsed as edits need it. */
class Workspace {
  readonly order: string[];
  private readonly sources: Map<string, string>;
  private readonly trees = new Map<string, Tree>();
  private readonly dirty = new Set<string>();
  private index: Map<string, Located> | null = null;

  constructor(state: DocxPackageState) {
    this.order = [...state.order];
    this.sources = new Map(state.blocks);
  }

  tree(block: string): Tree {
    const cached = this.trees.get(block);
    if (cached) return cached;
    const source = this.sources.get(block);
    if (source === undefined) throw new Error(`block ${block} has no content`);
    const root = parseElement(source);
    let pt = prefixFor(root, POWERTOOLS_NS);
    if (!pt) {
      pt = 'pt';
      setAttribute(root, `xmlns:${pt}`, POWERTOOLS_NS);
    }
    const tree = { root, names: { w: prefixFor(root, WORDML_NS) ?? 'w', pt } };
    this.trees.set(block, tree);
    return tree;
  }

  /** Find a top-level block, or a paragraph or table at any depth, by id. */
  locate(id: string): Located | null {
    if (!this.index) {
      this.index = new Map();
      for (const block of this.order) {
        const { root, names } = this.tree(block);
        this.index.set(block, { block, node: root, parent: null, names });
        const walk = (parent: XmlElement) => {
          for (const child of elementChildren(parent)) {
            if (
              isW(child, names, 'p') ||
              isW(child, names, 'tbl') ||
              isW(child, names, 'sdt')
            ) {
              const unid = unidOf(child, names);
              if (unid && !this.index!.has(unid))
                this.index!.set(unid, { block, node: child, parent, names });
            }
            walk(child);
          }
        };
        walk(root);
      }
    }
    return this.index.get(id) ?? null;
  }

  touch(block: string) {
    this.dirty.add(block);
    this.index = null;
  }

  insert(block: string, root: XmlElement, names: Names, at: number) {
    this.trees.set(block, { root, names });
    this.order.splice(at, 0, block);
    this.touch(block);
  }

  remove(block: string) {
    this.order.splice(this.order.indexOf(block), 1);
    this.index = null;
  }

  state(parts: DocxPackageState['parts']): DocxPackageState {
    const blocks = new Map<string, string>();
    for (const block of this.order) {
      const tree = this.dirty.has(block) ? this.trees.get(block) : undefined;
      blocks.set(
        block,
        tree ? serializeXml(tree.root) : (this.sources.get(block) ?? '')
      );
    }
    return { order: [...this.order], blocks, parts };
  }
}

class Editor {
  readonly workspace: Workspace;
  readonly touched = new Set<string>();
  readonly deleted: string[] = [];
  private readonly styles: ParagraphStyleInfo[];

  constructor(private readonly initial: DocxPackageState) {
    this.workspace = new Workspace(initial);
    this.styles = paragraphStyles(initial);
  }

  private paragraph(id: string): Located {
    const found = this.workspace.locate(id);
    if (!found)
      throw new DocxAgentError(
        `No paragraph or block has id ${id}. Read the document again for current ids.`
      );
    if (!isW(found.node, found.names, 'p'))
      throw new DocxAgentError(
        `${id} is a ${describeKind(found.node)}, not a paragraph. Address the paragraphs inside it.`
      );
    return found;
  }

  private changed(found: Located) {
    this.workspace.touch(found.block);
    this.touched.add(found.block);
  }

  private range(
    found: Located,
    find: string | undefined,
    occurrence: number | undefined
  ): [number, number] {
    const text = paragraphText(found.node, found.names);
    if (find === undefined) return [0, text.length];
    const matches = occurrences(text, find);
    const id = unidOf(found.node, found.names);
    if (matches.length === 0)
      throw new DocxAgentError(
        `"${preview(find, 80)}" does not appear in paragraph ${id}, whose text is: "${preview(text)}"`
      );
    if (occurrence === undefined && matches.length > 1)
      throw new DocxAgentError(
        `"${preview(find, 80)}" appears ${matches.length} times in paragraph ${id}; pass occurrence (1-${matches.length}) or a longer find.`
      );
    const index = (occurrence ?? 1) - 1;
    if (index < 0 || index >= matches.length)
      throw new DocxAgentError(
        `Paragraph ${id} has ${matches.length} occurrence(s) of "${preview(find, 80)}"; occurrence ${occurrence} is out of range.`
      );
    return [matches[index], matches[index] + find.length];
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

  private static singleLine(text: string, what: string) {
    if (/[\r\n]/.test(text))
      throw new DocxAgentError(
        `${what} cannot contain a line break; use insertParagraph to add paragraphs.`
      );
  }

  apply(operation: DocxAgentOperation) {
    switch (operation.type) {
      case 'replaceText': {
        Editor.singleLine(operation.replace, 'replace');
        if (!operation.find)
          throw new DocxAgentError('find must not be empty.');
        const found = this.paragraph(operation.paragraph);
        const [start, end] = this.range(
          found,
          operation.find,
          operation.occurrence
        );
        replaceRange(found.node, found.names, start, end, operation.replace);
        this.changed(found);
        return;
      }
      case 'setText': {
        Editor.singleLine(operation.text, 'text');
        const found = this.paragraph(operation.paragraph);
        const length = paragraphText(found.node, found.names).length;
        replaceRange(found.node, found.names, 0, length, operation.text);
        this.changed(found);
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
        const found = this.paragraph(operation.paragraph);
        const [start, end] = this.range(
          found,
          operation.find,
          operation.occurrence
        );
        if (start === end) return;
        formatRange(found.node, found.names, start, end, {
          bold,
          italic,
          underline,
          strikethrough,
        });
        this.changed(found);
        return;
      }
      case 'insertParagraph':
        this.insert(operation);
        return;
      case 'delete':
        this.delete(operation.id);
        return;
      case 'setStyle': {
        const found = this.paragraph(operation.paragraph);
        setParagraphStyle(
          found.node,
          found.names,
          this.resolveStyle(operation.style)
        );
        this.changed(found);
        return;
      }
      case 'addComment':
        // Refused before any operation runs (see runDocxAgentRequest).
        throw new DocxAgentError(
          'Word comments need the document in the current editor format.'
        );
    }
  }

  /** Paragraph properties for a paragraph typed next to `anchor`. */
  private newParagraphProperties(
    anchor: Located,
    style: string | undefined
  ): (names: Names) => XmlElement | null {
    const make = (styleId: string | null) => (names: Names) => {
      if (!styleId) return null;
      const holder = createParagraph(names, '', null);
      setParagraphStyle(holder, names, styleId);
      return elementChildren(holder)[0] ?? null;
    };
    if (style !== undefined) return make(this.resolveStyle(style));
    if (!isW(anchor.node, anchor.names, 'p')) return make(null);
    // As Word does on Enter: a style that names a different next style (a
    // heading, say) is followed by that style; any other paragraph is copied.
    const current = paragraphStyle(anchor.node, anchor.names);
    const info = current
      ? this.styles.find((s) => s.id === current)
      : undefined;
    if (info?.next && info.next !== info.id) {
      const next = this.styles.find((s) => s.id === info.next);
      return make(next?.isDefault ? null : info.next);
    }
    const pPr = elementChildren(anchor.node).find((c) =>
      isW(c, anchor.names, 'pPr')
    );
    return () => pPr ?? null;
  }

  private insert(
    operation: Extract<DocxAgentOperation, { type: 'insertParagraph' }>
  ) {
    const anchorId = operation.after ?? operation.before;
    if (!anchorId || (operation.after && operation.before))
      throw new DocxAgentError(
        'insertParagraph needs exactly one of after or before.'
      );
    const anchor = this.workspace.locate(anchorId);
    if (!anchor)
      throw new DocxAgentError(
        `No paragraph or block has id ${anchorId}. Read the document again for current ids.`
      );
    const properties = this.newParagraphProperties(anchor, operation.style);
    const lines = operation.text.replace(/\r\n?/g, '\n').split('\n');
    const after = operation.after !== undefined;

    if (anchor.parent) {
      const created = lines.map((line) =>
        createParagraph(anchor.names, line, properties(anchor.names))
      );
      const siblings = anchor.parent.children;
      siblings.splice(
        siblings.indexOf(anchor.node) + (after ? 1 : 0),
        0,
        ...created
      );
      this.changed(anchor);
      return;
    }

    // A top-level paragraph is a block of its own, declaring the namespaces
    // its anchor's markup relies on.
    const declarations = anchor.node.attributes.filter((a) =>
      a.name.startsWith('xmlns')
    );
    let at = this.workspace.order.indexOf(anchor.block) + (after ? 1 : 0);
    for (const line of lines) {
      const paragraph = createParagraph(
        anchor.names,
        line,
        properties(anchor.names)
      );
      paragraph.attributes = [
        ...declarations.map((a) => ({ ...a })),
        ...paragraph.attributes,
      ];
      const id = unidOf(paragraph, anchor.names) ?? newUnid();
      this.workspace.insert(id, paragraph, anchor.names, at++);
      this.touched.add(id);
    }
  }

  private delete(id: string) {
    const found = this.workspace.locate(id);
    if (!found)
      throw new DocxAgentError(
        `No paragraph or block has id ${id}. Read the document again for current ids.`
      );
    if (!found.parent) {
      if (this.workspace.order.length === 1)
        throw new DocxAgentError(
          'The document must keep at least one block; use setText to clear it instead.'
        );
      this.workspace.remove(found.block);
      this.touched.delete(found.block);
      this.deleted.push(found.block);
      return;
    }
    const siblings = found.parent.children;
    const remaining = elementChildren(found.parent).filter(
      (child) => child !== found.node
    );
    if (
      isW(found.parent, found.names, 'tc') &&
      !remaining.some(
        (child) =>
          isW(child, found.names, 'p') || isW(child, found.names, 'tbl')
      )
    )
      throw new DocxAgentError(
        `Paragraph ${id} is the only paragraph in its table cell; use setText with empty text to clear it.`
      );
    siblings.splice(siblings.indexOf(found.node), 1);
    this.changed(found);
  }

  result(): DocxPackageState {
    return this.workspace.state(this.initial.parts);
  }
}

function describeKind(node: XmlElement): string {
  switch (localName(node)) {
    case 'tbl':
      return 'table';
    case 'sdt':
      return 'content control';
    default:
      return localName(node);
  }
}

/** Apply `operations` atomically: any failure leaves the document unchanged. */
export function applyDocxOperations(
  state: DocxPackageState,
  operations: readonly DocxAgentOperation[]
): { state: DocxPackageState; touched: string[]; deleted: string[] } {
  if (operations.length === 0 || operations.length > MAX_DOCX_OPERATIONS)
    throw new DocxAgentError(
      `Send between 1 and ${MAX_DOCX_OPERATIONS} operations.`
    );
  const editor = new Editor(state);
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
  const next = editor.result();
  return {
    state: next,
    touched: next.order.filter((id) => editor.touched.has(id)),
    deleted: editor.deleted,
  };
}

const quote = (text: string) => `"${preview(text, 60)}"`;

/** Formatted spans worth telling a reader about, e.g. `bold: "Agreement"`. */
function formattingNotes(paragraph: XmlElement, names: Names): string[] {
  const kinds = ['bold', 'italic', 'underline', 'strikethrough'] as const;
  const spans: Record<(typeof kinds)[number], string[]> = {
    bold: [],
    italic: [],
    underline: [],
    strikethrough: [],
  };
  const open: Partial<Record<(typeof kinds)[number], string>> = {};
  const all = segments(paragraph, names);
  all.forEach((segment, index) => {
    const format = runFormat(segment.run, names);
    for (const kind of kinds) {
      if (format[kind]) open[kind] = (open[kind] ?? '') + segment.text;
      if ((!format[kind] || index === all.length - 1) && open[kind]) {
        if (open[kind]!.trim()) spans[kind].push(open[kind]!);
        open[kind] = undefined;
      }
    }
  });
  const fullText = all.map((s) => s.text).join('');
  return kinds.flatMap((kind) => {
    const list = spans[kind];
    if (list.length === 0) return [];
    if (list.length === 1 && list[0] === fullText) return [`${kind}: all`];
    const shown = list.slice(0, 6).map(quote).join(', ');
    return [`${kind}: ${shown}${list.length > 6 ? ', …' : ''}`];
  });
}

function paragraphLines(
  paragraph: XmlElement,
  names: Names,
  label: string,
  indent: string
): string[] {
  const id = unidOf(paragraph, names) ?? '?';
  const traits = [
    paragraphStyle(paragraph, names),
    paragraphAlignment(paragraph, names),
    isNumbered(paragraph, names) ? 'numbered' : null,
  ].filter(Boolean);
  const text = paragraphText(paragraph, names).replace(/\n/g, '↵');
  const head = `${indent}${label}paragraph ${id}${traits.length ? ` (${traits.join(', ')})` : ''}`;
  if (!text) return [`${head} (empty)`];
  return [
    `${head}`,
    `${indent}  ${text}`,
    ...formattingNotes(paragraph, names).map((note) => `${indent}  ${note}`),
  ];
}

/** Block-level content: paragraphs, tables and content controls. */
function contentLines(
  parent: XmlElement,
  names: Names,
  indent: string
): string[] {
  return elementChildren(parent).flatMap((child) => {
    if (isW(child, names, 'p')) return paragraphLines(child, names, '', indent);
    if (isW(child, names, 'tbl')) return tableLines(child, names, '', indent);
    if (isW(child, names, 'sdt')) return sdtLines(child, names, '', indent);
    return [];
  });
}

function tableLines(
  table: XmlElement,
  names: Names,
  label: string,
  indent: string
): string[] {
  const rows = elementChildren(table).filter((c) => isW(c, names, 'tr'));
  const columns = Math.max(
    0,
    ...rows.map(
      (row) => elementChildren(row).filter((c) => isW(c, names, 'tc')).length
    )
  );
  const lines = [
    `${indent}${label}table ${unidOf(table, names) ?? '?'}, ${rows.length} rows x ${columns} columns`,
  ];
  rows.forEach((row, r) => {
    elementChildren(row)
      .filter((c) => isW(c, names, 'tc'))
      .forEach((cell, c) => {
        lines.push(`${indent}  row ${r + 1}, cell ${c + 1}:`);
        lines.push(...contentLines(cell, names, `${indent}    `));
      });
  });
  return lines;
}

function sdtLines(
  sdt: XmlElement,
  names: Names,
  label: string,
  indent: string
): string[] {
  const properties = elementChildren(sdt).find((c) => isW(c, names, 'sdtPr'));
  const attribute = (local: string) => {
    const node =
      properties && findDescendant(properties, (n) => isW(n, names, local));
    return node ? getAttribute(node, `${names.w}:val`) : null;
  };
  const title =
    attribute('alias') ?? attribute('docPartGallery') ?? attribute('tag');
  const content = elementChildren(sdt).find((c) => isW(c, names, 'sdtContent'));
  return [
    `${indent}${label}content control ${unidOf(sdt, names) ?? '?'}${title ? ` (${title})` : ''}`,
    ...(content ? contentLines(content, names, `${indent}  `) : []),
  ];
}

function findDescendant(
  node: XmlElement,
  predicate: (node: XmlElement) => boolean
): XmlElement | null {
  for (const child of elementChildren(node)) {
    if (predicate(child)) return child;
    const found = findDescendant(child, predicate);
    if (found) return found;
  }
  return null;
}

function blockLines(tree: Tree, number: number): string[] {
  const { root, names } = tree;
  const label = `#${number} `;
  if (isW(root, names, 'p')) return paragraphLines(root, names, label, '');
  if (isW(root, names, 'tbl')) return tableLines(root, names, label, '');
  if (isW(root, names, 'sdt')) return sdtLines(root, names, label, '');
  // Bookmarks and other markers between paragraphs carry no content.
  return [];
}

/** The document as text an agent can act on: every block with its id. */
export function describeDocx(
  state: DocxPackageState,
  options: { start?: number; count?: number } = {}
): string {
  const workspace = new Workspace(state);
  const start = Math.max(1, Math.floor(options.start ?? 1));
  const end = Math.min(
    state.order.length,
    options.count
      ? start - 1 + Math.max(1, Math.floor(options.count))
      : Infinity
  );
  const styles = paragraphStyles(state);
  const used = new Set<string>();
  const body: string[] = [];
  let size = 0;
  let next: number | null = null;
  for (let number = start; number <= end; number++) {
    const tree = workspace.tree(state.order[number - 1]);
    const lines = blockLines(tree, number);
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
    ...styles.filter((s) => used.has(s.id)),
    ...styles.filter((s) => !used.has(s.id)),
  ]
    .slice(0, 40)
    .map((s) => s.id);
  const header = [
    `Word document with ${state.order.length} blocks${start > 1 || end < state.order.length ? `; showing #${start}-#${next ? next - 1 : end}` : ''}.`,
    'Ids are stable: pass them to EditWordDocument. Text is shown plain; lines like `bold: "..."` list formatted spans. ↵ is a line break inside a paragraph.',
    ...(styleList.length
      ? [
          `Paragraph styles: ${styleList.join(', ')}${styles.length > 40 ? ', …' : ''}.`,
        ]
      : []),
    '',
  ];
  const footer = next
    ? [
        '',
        `… ${state.order.length - next + 1} more blocks. Read again with start=${next} to continue.`,
      ]
    : [];
  return [...header, ...body, ...footer].join('\n');
}

/** How the touched blocks read after an edit, for the agent to check. */
function describeChanges(
  state: DocxPackageState,
  touched: readonly string[],
  deleted: readonly string[],
  count: number
): string {
  const workspace = new Workspace(state);
  const lines = [
    `Applied ${count} operation${count === 1 ? '' : 's'}. Everyone with the document open sees the change now.`,
  ];
  if (deleted.length) lines.push(`Deleted blocks: ${deleted.join(', ')}.`);
  if (touched.length) {
    lines.push('', 'Changed blocks as they now read:');
    let size = 0;
    for (const id of touched) {
      const blockLinesForId = blockLines(
        workspace.tree(id),
        state.order.indexOf(id) + 1
      );
      size += blockLinesForId.join('\n').length;
      if (size > READ_BUDGET) {
        lines.push('… (more changed blocks; read the document to see them)');
        break;
      }
      lines.push(...blockLinesForId);
    }
  }
  return lines.join('\n');
}

/** The part of a sync source a one-shot agent request needs. */
export type DocxAgentSource = Pick<
  LiveSyncSource,
  'pushUpdate' | 'registerPeerId'
> & {
  doInitialSync(): ResultAsync<InitialSync, TimeoutError>;
};

/**
 * Join the document as a Loro peer, answer one read or apply one edit, and
 * push the edit to everyone. The edit is made on the state merged from the
 * server a moment before and lands as ordinary CRDT operations, so open
 * editors patch it in and concurrent edits to other paragraphs merge.
 */
export async function runDocxAgentRequest(
  source: DocxAgentSource,
  request: DocxAgentRequest
): Promise<DocxAgentResult> {
  const initial = await source.doInitialSync();
  if (initial.isErr())
    throw new Error(
      `initial sync failed: ${initial.error.type} (${initial.error.duration}ms)`
    );
  const doc = new LoroDoc();
  if (initial.value.snapshot.length > 0) doc.import(initial.value.snapshot);
  // The editor's shared format: blocks and rich text the engine writes.
  if (isWordFormat(doc)) {
    if (request.action === 'read')
      return { content: describeWord(doc, request) };
    const version = doc.version();
    const content = editWord(doc, request.operations, {
      trackChanges: request.trackChanges,
      author: request.author,
    });
    const update = doc.export({ mode: 'update', from: version });
    source.registerPeerId(doc.peerId);
    if (!(await source.pushUpdate([update])))
      throw new Error('the sync service did not acknowledge the edit');
    return { content };
  }
  if (!isDocxSeeded(doc))
    throw new DocxAgentError(
      "This Word document hasn't been opened in Macro's editor yet, so it has no live copy to read or edit. Ask the user to open it once in Macro, then try again."
    );
  const state = readDocxState(doc);
  if (request.action === 'read')
    return { content: describeDocx(state, request) };
  // The first collaborative format predates tracked changes and Word
  // comments here; opening the document in Macro upgrades it.
  const tracked =
    request.trackChanges ??
    tracksRevisions(state.parts.get('word/settings.xml'));
  if (tracked || request.operations.some((o) => o.type === 'addComment'))
    throw new DocxAgentError(
      "This Word document is still in Macro's previous editor format, which cannot record tracked changes or Word comments. Ask the user to open it once in Macro (that upgrades it), then try again; or pass trackChanges false to edit it directly without comments."
    );

  const result = applyDocxOperations(state, request.operations);
  const version = doc.version();
  writeDocxChanges(doc, diffDocxStates(state, result.state));
  const update = doc.export({ mode: 'update', from: version });
  source.registerPeerId(doc.peerId);
  if (!(await source.pushUpdate([update])))
    throw new Error('the sync service did not acknowledge the edit');
  return {
    content: describeChanges(
      result.state,
      result.touched,
      result.deleted,
      request.operations.length
    ),
  };
}
