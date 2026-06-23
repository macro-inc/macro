/**
 * The AI-facing editing surface. The model is handed one `editor` and calls its
 * methods; each method is pure sugar that validates ids eagerly and pushes a
 * semantic `DocumentOp` onto an internal array. Nothing here touches Lexical,
 * and running the AI's snippet just fills `ops`, which the queue then animates
 * and applies. A method that references an unknown id (or violates a sanity
 * check) throws `EditError` on the spot, so the tool can report it to the model
 * before anything is applied.
 *
 * Creators (`insert*`, `append*`, table builders) return a `Ref`: a handle to
 * the not-yet-created node that later calls can target; `Doc` resolves it to a
 * real id at apply time.
 */
import { EditError } from './errors';
import type {
  BlockType,
  DocumentOp,
  Format,
  ListKind,
  MentionSpec,
  NodeId,
  NodeSpec,
  Position,
  Ref,
  Scope,
} from './ops';

export type DocumentEditorOptions = {
  /** Durable ids present in the document the model was shown. */
  validIds: Iterable<NodeId>;
};

let refSeq = 0;

export class DocumentEditor {
  private ops: DocumentOp[] = [];
  private valid: Set<string>;

  constructor(opts: DocumentEditorOptions) {
    this.valid = new Set(opts.validIds);
  }

  private push(op: DocumentOp): this {
    this.ops.push(op);
    return this;
  }

  private requireId(id: NodeId): void {
    if (!this.valid.has(id)) {
      throw new EditError(`unknown id "${id}"`);
    }
  }

  private requireMatch(match: string): void {
    if (match.length === 0) throw new EditError('match string is empty');
  }

  private mintRef(): Ref {
    const ref = `ref-${++refSeq}`;
    this.valid.add(ref); // later calls may target the new node
    return ref;
  }

  /** Hand the accumulated ops to the queue and reset. */
  drain(): DocumentOp[] {
    const out = this.ops;
    this.ops = [];
    return out;
  }

  format(id: NodeId, match: string, format: Format, on = true, scope: Scope = { all: true }): this {
    this.requireId(id);
    this.requireMatch(match);
    return this.push({ kind: 'formatText', id, match, format, on, scope });
  }
  bold(id: NodeId, match: string, scope?: Scope): this { return this.format(id, match, 'bold', true, scope); }
  italic(id: NodeId, match: string, scope?: Scope): this { return this.format(id, match, 'italic', true, scope); }
  underline(id: NodeId, match: string, scope?: Scope): this { return this.format(id, match, 'underline', true, scope); }
  strike(id: NodeId, match: string, scope?: Scope): this { return this.format(id, match, 'strike', true, scope); }
  inlineCode(id: NodeId, match: string, scope?: Scope): this { return this.format(id, match, 'code', true, scope); }
  unbold(id: NodeId, match: string, scope?: Scope): this { return this.format(id, match, 'bold', false, scope); }
  unitalic(id: NodeId, match: string, scope?: Scope): this { return this.format(id, match, 'italic', false, scope); }
  ununderline(id: NodeId, match: string, scope?: Scope): this { return this.format(id, match, 'underline', false, scope); }
  unstrike(id: NodeId, match: string, scope?: Scope): this { return this.format(id, match, 'strike', false, scope); }
  uninlineCode(id: NodeId, match: string, scope?: Scope): this { return this.format(id, match, 'code', false, scope); }

  /** Strip all inline formatting from matched substrings (or the whole block if
   *  `match` is omitted). */
  clearFormat(id: NodeId, match?: string, scope: Scope = { all: true }): this {
    this.requireId(id);
    if (match !== undefined) this.requireMatch(match);
    return this.push({ kind: 'clearFormat', id, match, scope });
  }
  clearAllFormat(id: NodeId): this { return this.clearFormat(id); }

  highlight(id: NodeId, match: string, scope: Scope = { all: true }): this {
    this.requireId(id);
    this.requireMatch(match);
    return this.push({ kind: 'markText', id, match, on: true, scope });
  }
  unhighlight(id: NodeId, match: string, scope: Scope = { all: true }): this {
    this.requireId(id);
    this.requireMatch(match);
    return this.push({ kind: 'markText', id, match, on: false, scope });
  }

  link(id: NodeId, match: string, url: string, scope: Scope = { all: true }): this {
    this.requireId(id);
    this.requireMatch(match);
    return this.push({ kind: 'linkText', id, match, url, scope });
  }
  unlink(id: NodeId, match: string, scope: Scope = { all: true }): this {
    this.requireId(id);
    this.requireMatch(match);
    return this.push({ kind: 'linkText', id, match, url: null, scope });
  }

  formatNode(textId: NodeId, format: Format, on = true): this {
    this.requireId(textId);
    return this.push({ kind: 'formatNode', textId, format, on });
  }
  boldNode(textId: NodeId): this { return this.formatNode(textId, 'bold'); }
  italicNode(textId: NodeId): this { return this.formatNode(textId, 'italic'); }
  underlineNode(textId: NodeId): this { return this.formatNode(textId, 'underline'); }
  strikeNode(textId: NodeId): this { return this.formatNode(textId, 'strike'); }
  codeNode(textId: NodeId): this { return this.formatNode(textId, 'code'); }
  clearNodeFormat(textId: NodeId): this {
    this.requireId(textId);
    return this.push({ kind: 'clearNodeFormat', textId });
  }

  setText(id: NodeId, text: string): this {
    this.requireId(id);
    return this.push({ kind: 'setText', id, text });
  }
  setEquation(id: NodeId, tex: string): this {
    this.requireId(id);
    return this.push({ kind: 'setEquation', id, tex });
  }
  replace(id: NodeId, find: string, to: string, scope: Scope = { all: true }): this {
    this.requireId(id);
    if (find.length === 0) throw new EditError('find string is empty');
    return this.push({ kind: 'replaceText', id, find, to, scope });
  }
  appendText(id: NodeId, text: string): this {
    this.requireId(id);
    return this.push({ kind: 'appendText', id, text });
  }
  prependText(id: NodeId, text: string): this {
    this.requireId(id);
    return this.push({ kind: 'prependText', id, text });
  }

  private setBlockType(id: NodeId, block: BlockType, extra: { level?: number; language?: string } = {}): this {
    this.requireId(id);
    return this.push({ kind: 'setBlockType', id, block, ...extra });
  }
  convertToParagraph(id: NodeId): this { return this.setBlockType(id, 'paragraph'); }
  convertToHeading(id: NodeId, level: number): this {
    if (level < 1 || level > 6) throw new EditError(`heading level must be 1-6, got ${level}`);
    return this.setBlockType(id, 'heading', { level });
  }
  convertToQuote(id: NodeId): this { return this.setBlockType(id, 'quote'); }
  convertToCodeBlock(id: NodeId, language?: string): this { return this.setBlockType(id, 'code', { language }); }

  private toList(idOrIds: NodeId | NodeId[], list: ListKind): this {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    if (ids.length === 0) throw new EditError('list requires at least one block');
    for (const id of ids) this.requireId(id);
    return this.push({ kind: 'setListType', ids, list });
  }
  bulletList(idOrIds: NodeId | NodeId[]): this { return this.toList(idOrIds, 'bullet'); }
  numberedList(idOrIds: NodeId | NodeId[]): this { return this.toList(idOrIds, 'number'); }
  checklist(idOrIds: NodeId | NodeId[]): this { return this.toList(idOrIds, 'check'); }
  setListType(id: NodeId, list: ListKind): this { return this.toList(id, list); }

  check(id: NodeId): this { return this.setChecked(id, true); }
  uncheck(id: NodeId): this { return this.setChecked(id, false); }
  setChecked(id: NodeId, checked: boolean): this {
    this.requireId(id);
    return this.push({ kind: 'setChecked', id, checked });
  }

  indent(id: NodeId, by = 1): this {
    this.requireId(id);
    return this.push({ kind: 'setIndent', id, indent: by >= 0 ? 'in' : 'out' });
  }
  outdent(id: NodeId, by = 1): this { return this.indent(id, -Math.abs(by)); }
  setIndent(id: NodeId, level: number): this {
    this.requireId(id);
    if (level < 0) throw new EditError(`indent level must be >= 0, got ${level}`);
    return this.push({ kind: 'setIndent', id, indent: level });
  }
  sortList(id: NodeId, order: 'asc' | 'desc' = 'asc'): this {
    this.requireId(id);
    return this.push({ kind: 'sortList', id, order });
  }

  private insert(spec: NodeSpec, at: Position): Ref {
    this.requireAt(at);
    const ref = this.mintRef();
    this.push({ kind: 'insertBlock', ref, spec, at });
    return ref;
  }
  private requireAt(at: Position): void {
    if ('after' in at) this.requireId(at.after);
    else if ('before' in at) this.requireId(at.before);
  }
  insertParagraphAfter(id: NodeId, text = ''): Ref { return this.insert({ block: 'paragraph', text }, { after: id }); }
  insertParagraphBefore(id: NodeId, text = ''): Ref { return this.insert({ block: 'paragraph', text }, { before: id }); }
  insertHeadingAfter(id: NodeId, level: 1 | 2 | 3 | 4 | 5 | 6, text = ''): Ref { return this.insert({ block: 'heading', level, text }, { after: id }); }
  insertHeadingBefore(id: NodeId, level: 1 | 2 | 3 | 4 | 5 | 6, text = ''): Ref { return this.insert({ block: 'heading', level, text }, { before: id }); }
  insertQuoteAfter(id: NodeId, text = ''): Ref { return this.insert({ block: 'quote', text }, { after: id }); }
  insertCodeBlockAfter(id: NodeId, language?: string, text = ''): Ref { return this.insert({ block: 'code', language, text }, { after: id }); }
  insertBlockAfter(id: NodeId, spec: NodeSpec): Ref { return this.insert(spec, { after: id }); }
  insertBlockBefore(id: NodeId, spec: NodeSpec): Ref { return this.insert(spec, { before: id }); }
  appendParagraph(text = ''): Ref { return this.insert({ block: 'paragraph', text }, { appendToRoot: true }); }
  prependParagraph(text = ''): Ref { return this.insert({ block: 'paragraph', text }, { prependToRoot: true }); }
  appendBlock(spec: NodeSpec): Ref { return this.insert(spec, { appendToRoot: true }); }
  prependBlock(spec: NodeSpec): Ref { return this.insert(spec, { prependToRoot: true }); }

  move(id: NodeId, at: Position): this {
    this.requireId(id);
    this.requireAt(at);
    return this.push({ kind: 'moveBlock', id, at });
  }
  remove(id: NodeId): this {
    this.requireId(id);
    return this.push({ kind: 'removeBlock', id });
  }
  removeMany(ids: NodeId[]): this {
    for (const id of ids) this.remove(id);
    return this;
  }
  merge(ids: NodeId[], separator = ' '): this {
    if (ids.length < 2) throw new EditError('merge requires at least two blocks');
    for (const id of ids) this.requireId(id);
    return this.push({ kind: 'mergeBlocks', ids, separator });
  }
  split(id: NodeId, atText: string): this {
    this.requireId(id);
    this.requireMatch(atText);
    return this.push({ kind: 'splitBlock', id, atText });
  }

  insertTableAfter(id: NodeId, rows: string[][]): Ref { return this.buildTable(rows, { after: id }); }
  insertTableBefore(id: NodeId, rows: string[][]): Ref { return this.buildTable(rows, { before: id }); }
  appendTable(rows: string[][]): Ref { return this.buildTable(rows, { appendToRoot: true }); }
  private buildTable(rows: string[][], at: Position): Ref {
    if (rows.length === 0) throw new EditError('table requires at least one row');
    const empty = rows.map((row) => row.map(() => ''));
    const ref = this.insert({ block: 'table', rows: empty }, at);
    rows.forEach((row, r) => row.forEach((cell, c) => { if (cell) this.setCell(ref, r, c, cell); }));
    return ref;
  }
  setCell(table: NodeId, row: number, col: number, content: string): this {
    this.requireId(table);
    this.requireCell(row, col);
    return this.push({ kind: 'setCell', table, row, col, content });
  }
  addRow(table: NodeId, at?: number): this {
    this.requireId(table);
    return this.push({ kind: 'addRow', table, at });
  }
  addColumn(table: NodeId, at?: number): this {
    this.requireId(table);
    return this.push({ kind: 'addColumn', table, at });
  }
  removeRow(table: NodeId, row: number): this {
    this.requireId(table);
    this.requireCell(row, 0);
    return this.push({ kind: 'removeRow', table, row });
  }
  removeColumn(table: NodeId, col: number): this {
    this.requireId(table);
    this.requireCell(0, col);
    return this.push({ kind: 'removeColumn', table, col });
  }
  private requireCell(row: number, col: number): void {
    if (row < 0 || col < 0) throw new EditError(`cell indices must be >= 0, got (${row}, ${col})`);
  }

  insertDivider(afterId: NodeId): Ref { return this.insert({ block: 'divider' }, { after: afterId }); }
  insertImage(afterId: NodeId, img: { srcType: string; url: string; alt?: string; width?: number; height?: number }): Ref {
    return this.insert({ block: 'image', ...img }, { after: afterId });
  }
  insertVideo(afterId: NodeId, vid: { srcType: string; url: string; controls?: boolean; width?: number; height?: number }): Ref {
    return this.insert({ block: 'video', ...vid }, { after: afterId });
  }
  insertEquation(afterId: NodeId, tex: string): Ref { return this.insert({ block: 'equation', tex }, { after: afterId }); }
  insertInlineEquation(blockId: NodeId, at: number, tex: string): Ref { return this.insertInline(blockId, at, { inline: 'equation', tex }); }
  insertLineBreak(blockId: NodeId, at: number): Ref { return this.insertInline(blockId, at, { inline: 'linebreak' }); }
  insertDate(blockId: NodeId, at: number, isoDate: string, displayFormat?: string): Ref {
    return this.insertInline(blockId, at, { inline: 'date', date: isoDate, displayFormat });
  }
  private insertInline(id: NodeId, at: number, spec: NodeSpec): Ref {
    this.requireId(id);
    if (at < 0) throw new EditError(`inline offset must be >= 0, got ${at}`);
    const ref = this.mintRef();
    this.push({ kind: 'insertInline', ref, id, at, spec });
    return ref;
  }

  insertMention(blockId: NodeId, at: number, mention: MentionSpec): Ref {
    return this.insertInline(blockId, at, { inline: 'mention', mention });
  }
  mentionUser(blockId: NodeId, at: number, entity: { userId: string; email: string }): Ref {
    return this.insertMention(blockId, at, { kind: 'user', ...entity });
  }
  mentionContact(blockId: NodeId, at: number, entity: { contactId: string; name: string; emailOrDomain: string; isCompany: boolean }): Ref {
    return this.insertMention(blockId, at, { kind: 'contact', ...entity });
  }
  mentionGroup(blockId: NodeId, at: number, entity: { groupAlias: string }): Ref {
    return this.insertMention(blockId, at, { kind: 'group', ...entity });
  }
  mentionDocument(blockId: NodeId, at: number, entity: { documentId: string; documentName: string; blockName: string }): Ref {
    return this.insertMention(blockId, at, { kind: 'document', ...entity });
  }

  setImageAlt(id: NodeId, alt: string): this { this.requireId(id); return this.push({ kind: 'setImageAlt', id, alt }); }
  setImageUrl(id: NodeId, url: string): this { this.requireId(id); return this.push({ kind: 'setImageUrl', id, url }); }
  setVideoUrl(id: NodeId, url: string): this { this.requireId(id); return this.push({ kind: 'setVideoUrl', id, url }); }
  setVideoControls(id: NodeId, controls: boolean): this { this.requireId(id); return this.push({ kind: 'setVideoControls', id, controls }); }
  setDate(id: NodeId, date: string, displayFormat?: string): this { this.requireId(id); return this.push({ kind: 'setDate', id, date, displayFormat }); }
}

export type { MentionSpec };
