// IMPORTANT: this class runs inside the QuickJS sandbox via a generated bundle.
// If you change it, regenerate the sandbox (`bun scripts/generate-sandbox.ts`)
// or the AI's editor surface won't reflect your edits.
import { EditError } from './errors';
import type {
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

type SetBlockTypeArgs =
  | { block: 'paragraph' }
  | { block: 'heading'; level: number }
  | { block: 'quote' }
  | { block: 'code'; language: string };

export type DocumentEditorOptions = {
  /** Durable ids present in the document the model was shown. */
  validIds: Iterable<NodeId>;
  /** A pool of globally-unique ids the host pre-generated (the sandbox has no
   *  good entropy of its own). Each insert pops one and stamps it as the new
   *  node's durable id, so inserted ids never collide — across concurrent
   *  writers, repeated runs, or sessions. */
  refs: string[];
};

export class DocumentEditor {
  private ops: DocumentOp[] = [];
  private valid: Set<string>;
  private refs: string[];
  private refIdx = 0;

  constructor(opts: DocumentEditorOptions) {
    this.valid = new Set(opts.validIds);
    this.refs = opts.refs;
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
    const ref = this.refs[this.refIdx++];
    if (!ref) {
      throw new EditError(
        'too many inserts in one snippet (id pool exhausted)'
      );
    }
    this.valid.add(ref);
    return ref;
  }

  /** Hand the accumulated ops to the queue and reset. */
  public drain(): DocumentOp[] {
    const out = this.ops;
    this.ops = [];
    return out;
  }

  public format(
    id: NodeId,
    match: string,
    format: Format,
    on = true,
    scope: Scope = { kind: 'all' }
  ): this {
    this.requireId(id);
    this.requireMatch(match);
    return this.push({
      kind: 'formatText',
      node: id,
      match,
      format,
      on,
      scope,
    });
  }
  public bold(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'bold', true, scope);
  }

  public italic(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'italic', true, scope);
  }

  public underline(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'underline', true, scope);
  }

  public strike(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'strike', true, scope);
  }

  public inlineCode(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'code', true, scope);
  }

  public unbold(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'bold', false, scope);
  }

  public unitalic(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'italic', false, scope);
  }

  public ununderline(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'underline', false, scope);
  }

  public unstrike(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'strike', false, scope);
  }

  public uninlineCode(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'code', false, scope);
  }

  /** Strip all inline formatting from matched substrings (or the whole block if
   *  `match` is omitted). */
  public clearFormat(
    id: NodeId,
    match?: string,
    scope: Scope = { kind: 'all' }
  ): this {
    this.requireId(id);
    if (match !== undefined) this.requireMatch(match);
    return this.push({ kind: 'clearFormat', node: id, match, scope });
  }
  public clearAllFormat(id: NodeId): this {
    return this.clearFormat(id);
  }

  public highlight(
    id: NodeId,
    match: string,
    scope: Scope = { kind: 'all' }
  ): this {
    this.requireId(id);
    this.requireMatch(match);
    return this.push({ kind: 'markText', node: id, match, on: true, scope });
  }
  public unhighlight(
    id: NodeId,
    match: string,
    scope: Scope = { kind: 'all' }
  ): this {
    this.requireId(id);
    this.requireMatch(match);
    return this.push({ kind: 'markText', node: id, match, on: false, scope });
  }

  public link(
    id: NodeId,
    match: string,
    url: string,
    scope: Scope = { kind: 'all' }
  ): this {
    this.requireId(id);
    this.requireMatch(match);
    return this.push({ kind: 'linkText', node: id, match, url, scope });
  }
  public unlink(
    id: NodeId,
    match: string,
    scope: Scope = { kind: 'all' }
  ): this {
    this.requireId(id);
    this.requireMatch(match);
    return this.push({ kind: 'linkText', node: id, match, url: null, scope });
  }

  public formatNode(node: NodeId, format: Format, on = true): this {
    this.requireId(node);
    return this.push({ kind: 'formatNode', node, format, on });
  }
  public boldNode(node: NodeId): this {
    return this.formatNode(node, 'bold');
  }

  public italicNode(node: NodeId): this {
    return this.formatNode(node, 'italic');
  }

  public underlineNode(node: NodeId): this {
    return this.formatNode(node, 'underline');
  }

  public strikeNode(node: NodeId): this {
    return this.formatNode(node, 'strike');
  }

  public codeNode(node: NodeId): this {
    return this.formatNode(node, 'code');
  }

  public clearNodeFormat(node: NodeId): this {
    this.requireId(node);
    return this.push({ kind: 'clearNodeFormat', node });
  }

  public setText(id: NodeId, text: string): this {
    this.requireId(id);
    return this.push({ kind: 'setText', node: id, text });
  }
  public setEquation(id: NodeId, tex: string): this {
    this.requireId(id);
    return this.push({ kind: 'setEquation', node: id, tex });
  }
  public replace(
    id: NodeId,
    find: string,
    to: string,
    scope: Scope = { kind: 'all' }
  ): this {
    this.requireId(id);
    if (find.length === 0) throw new EditError('find string is empty');
    return this.push({ kind: 'replaceText', node: id, find, to, scope });
  }
  public appendText(id: NodeId, text: string): this {
    this.requireId(id);
    return this.push({ kind: 'appendText', node: id, text });
  }
  public prependText(id: NodeId, text: string): this {
    this.requireId(id);
    return this.push({ kind: 'prependText', node: id, text });
  }

  private setBlockType(id: NodeId, args: SetBlockTypeArgs): this {
    this.requireId(id);
    return this.push({ kind: 'setBlockType', node: id, ...args });
  }

  private requireLanguage(language: string): void {
    if (typeof language !== 'string' || language.trim().length === 0)
      throw new EditError('code block language is required');
  }

  public convertToParagraph(id: NodeId): this {
    return this.setBlockType(id, { block: 'paragraph' });
  }

  public convertToHeading(id: NodeId, level: number): this {
    if (level < 1 || level > 6)
      throw new EditError(`heading level must be 1-6, got ${level}`);
    return this.setBlockType(id, { block: 'heading', level });
  }

  public convertToQuote(id: NodeId): this {
    return this.setBlockType(id, { block: 'quote' });
  }

  public convertToCodeBlock(id: NodeId, language: string): this {
    this.requireLanguage(language);
    return this.setBlockType(id, { block: 'code', language });
  }

  public setLanguage(id: NodeId, language: string): this {
    return this.convertToCodeBlock(id, language);
  }

  private toList(idOrIds: NodeId | NodeId[], list: ListKind): this {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    if (ids.length === 0)
      throw new EditError('list requires at least one block');
    for (const id of ids) this.requireId(id);
    return this.push({ kind: 'setListType', nodes: ids, list });
  }
  public bulletList(idOrIds: NodeId | NodeId[]): this {
    return this.toList(idOrIds, 'bullet');
  }

  public numberedList(idOrIds: NodeId | NodeId[]): this {
    return this.toList(idOrIds, 'number');
  }

  public checklist(idOrIds: NodeId | NodeId[]): this {
    return this.toList(idOrIds, 'check');
  }

  public setListType(id: NodeId, list: ListKind): this {
    return this.toList(id, list);
  }

  public check(id: NodeId): this {
    return this.setChecked(id, true);
  }

  public uncheck(id: NodeId): this {
    return this.setChecked(id, false);
  }

  public setChecked(id: NodeId, checked: boolean): this {
    this.requireId(id);
    return this.push({ kind: 'setChecked', node: id, checked });
  }

  public indent(id: NodeId, by = 1): this {
    this.requireId(id);
    return this.push({
      kind: 'setIndent',
      node: id,
      indent: by >= 0 ? 'in' : 'out',
    });
  }
  public outdent(id: NodeId, by = 1): this {
    return this.indent(id, -Math.abs(by));
  }

  public setIndent(id: NodeId, level: number): this {
    this.requireId(id);
    if (level < 0)
      throw new EditError(`indent level must be >= 0, got ${level}`);
    return this.push({ kind: 'setIndent', node: id, indent: level });
  }
  public insertListItemAfter(
    id: NodeId,
    text: string,
    list: ListKind = 'bullet'
  ): Ref {
    this.requireId(id);
    const ref = this.mintRef();
    this.push({ kind: 'insertListItemAfter', ref, node: id, text, list });
    return ref;
  }

  public insertListItemBefore(
    id: NodeId,
    text: string,
    list: ListKind = 'bullet'
  ): Ref {
    this.requireId(id);
    const ref = this.mintRef();
    this.push({ kind: 'insertListItemBefore', ref, node: id, text, list });
    return ref;
  }

  public removeListItem(id: NodeId): this {
    this.requireId(id);
    return this.push({ kind: 'removeListItem', node: id });
  }

  private insert(spec: NodeSpec, at: Position): Ref {
    this.requireAt(at);
    const ref = this.mintRef();
    this.push({ kind: 'insertNode', ref, spec, at });
    return ref;
  }
  private requireAt(at: Position): void {
    if ('after' in at) this.requireId(at.after);
    else if ('before' in at) this.requireId(at.before);
  }

  public insertParagraphAfter(id: NodeId, text = ''): Ref {
    return this.insert({ block: 'paragraph', text }, { after: id });
  }

  public insertParagraphBefore(id: NodeId, text = ''): Ref {
    return this.insert({ block: 'paragraph', text }, { before: id });
  }

  public insertHeadingAfter(
    id: NodeId,
    level: 1 | 2 | 3 | 4 | 5 | 6,
    text = ''
  ): Ref {
    return this.insert({ block: 'heading', level, text }, { after: id });
  }

  public insertHeadingBefore(
    id: NodeId,
    level: 1 | 2 | 3 | 4 | 5 | 6,
    text = ''
  ): Ref {
    return this.insert({ block: 'heading', level, text }, { before: id });
  }

  public insertQuoteAfter(id: NodeId, text = ''): Ref {
    return this.insert({ block: 'quote', text }, { after: id });
  }

  public insertCodeBlockAfter(id: NodeId, language: string, text = ''): Ref {
    this.requireLanguage(language);
    return this.insert({ block: 'code', language, text }, { after: id });
  }

  public insertBlockAfter(id: NodeId, spec: NodeSpec): Ref {
    return this.insert(spec, { after: id });
  }

  public insertBlockBefore(id: NodeId, spec: NodeSpec): Ref {
    return this.insert(spec, { before: id });
  }

  public appendParagraph(text = ''): Ref {
    return this.insert({ block: 'paragraph', text }, { appendToRoot: true });
  }

  public prependParagraph(text = ''): Ref {
    return this.insert({ block: 'paragraph', text }, { prependToRoot: true });
  }

  public appendBlock(spec: NodeSpec): Ref {
    return this.insert(spec, { appendToRoot: true });
  }

  public prependBlock(spec: NodeSpec): Ref {
    return this.insert(spec, { prependToRoot: true });
  }

  public move(id: NodeId, at: Position): this {
    this.requireId(id);
    this.requireAt(at);
    return this.push({ kind: 'moveNode', node: id, at });
  }
  public remove(id: NodeId): this {
    this.requireId(id);
    return this.push({ kind: 'removeNode', node: id });
  }
  public removeMany(ids: NodeId[]): this {
    for (const id of ids) this.remove(id);
    return this;
  }
  public merge(ids: NodeId[], separator = ' '): this {
    if (ids.length < 2)
      throw new EditError('merge requires at least two blocks');
    for (const id of ids) this.requireId(id);
    return this.push({ kind: 'mergeBlocks', nodes: ids, separator });
  }
  public insertTableAfter(id: NodeId, rows: string[][]): Ref {
    return this.buildTable(rows, { after: id });
  }

  public insertTableBefore(id: NodeId, rows: string[][]): Ref {
    return this.buildTable(rows, { before: id });
  }

  public appendTable(rows: string[][]): Ref {
    return this.buildTable(rows, { appendToRoot: true });
  }

  private buildTable(rows: string[][], at: Position): Ref {
    if (rows.length === 0)
      throw new EditError('table requires at least one row');
    const empty = rows.map((row) => row.map(() => ''));
    const ref = this.insert({ block: 'table', rows: empty }, at);
    rows.forEach(
      (row, r) =>
        void row.forEach((cell, c) => {
          if (cell) this.setCell(ref, r, c, cell);
        })
    );
    return ref;
  }

  public setCell(table: NodeId, row: number, col: number, text: string): this {
    this.requireId(table);
    this.requireCell(row, col);
    return this.push({ kind: 'setCell', table, row, col, text });
  }
  public addRow(table: NodeId, at?: number): this {
    this.requireId(table);
    return this.push({ kind: 'addRow', table, at });
  }
  public addColumn(table: NodeId, at?: number): this {
    this.requireId(table);
    return this.push({ kind: 'addColumn', table, at });
  }
  public removeRow(table: NodeId, row: number): this {
    this.requireId(table);
    this.requireCell(row, 0);
    return this.push({ kind: 'removeRow', table, row });
  }
  public removeColumn(table: NodeId, col: number): this {
    this.requireId(table);
    this.requireCell(0, col);
    return this.push({ kind: 'removeColumn', table, col });
  }
  private requireCell(row: number, col: number): void {
    if (row < 0 || col < 0)
      throw new EditError(`cell indices must be >= 0, got (${row}, ${col})`);
  }

  public insertDivider(afterId: NodeId): Ref {
    return this.insert({ block: 'divider' }, { after: afterId });
  }

  public insertImage(
    afterId: NodeId,
    img: {
      srcType: string;
      url: string;
      alt?: string;
      width?: number;
      height?: number;
    }
  ): Ref {
    return this.insert({ block: 'image', ...img }, { after: afterId });
  }

  public insertVideo(
    afterId: NodeId,
    vid: {
      srcType: string;
      url: string;
      controls?: boolean;
      width?: number;
      height?: number;
    }
  ): Ref {
    return this.insert({ block: 'video', ...vid }, { after: afterId });
  }

  public insertEquation(afterId: NodeId, tex: string): Ref {
    return this.insert({ block: 'equation', tex }, { after: afterId });
  }

  public insertInlineEquation(blockId: NodeId, at: number, tex: string): Ref {
    return this.insertInline(blockId, at, { inline: 'equation', tex });
  }

  public insertLineBreak(blockId: NodeId, at: number): Ref {
    return this.insertInline(blockId, at, { inline: 'linebreak' });
  }

  public insertDate(
    blockId: NodeId,
    at: number,
    isoDate: string,
    displayFormat?: string
  ): Ref {
    return this.insertInline(blockId, at, {
      inline: 'date',
      date: isoDate,
      displayFormat,
    });
  }
  private insertInline(id: NodeId, at: number, spec: NodeSpec): Ref {
    this.requireId(id);
    if (at < 0) throw new EditError(`inline offset must be >= 0, got ${at}`);
    const ref = this.mintRef();
    this.push({ kind: 'insertInline', ref, node: id, at, spec });
    return ref;
  }

  public insertMention(blockId: NodeId, at: number, mention: MentionSpec): Ref {
    return this.insertInline(blockId, at, { inline: 'mention', mention });
  }

  public mentionUser(
    blockId: NodeId,
    at: number,
    entity: { userId: string; email: string }
  ): Ref {
    return this.insertMention(blockId, at, { kind: 'user', ...entity });
  }

  public mentionContact(
    blockId: NodeId,
    at: number,
    entity: {
      contactId: string;
      name: string;
      emailOrDomain: string;
      isCompany: boolean;
    }
  ): Ref {
    return this.insertMention(blockId, at, { kind: 'contact', ...entity });
  }

  public mentionGroup(
    blockId: NodeId,
    at: number,
    entity: { groupAlias: string }
  ): Ref {
    return this.insertMention(blockId, at, { kind: 'group', ...entity });
  }

  public mentionDocument(
    blockId: NodeId,
    at: number,
    entity: { documentId: string; documentName: string; blockName: string }
  ): Ref {
    return this.insertMention(blockId, at, { kind: 'document', ...entity });
  }

  public setImageAlt(id: NodeId, alt: string): this {
    this.requireId(id);
    return this.push({ kind: 'setImageAlt', node: id, alt });
  }

  public setImageUrl(id: NodeId, url: string): this {
    this.requireId(id);
    return this.push({ kind: 'setImageUrl', node: id, url });
  }

  public setVideoUrl(id: NodeId, url: string): this {
    this.requireId(id);
    return this.push({ kind: 'setVideoUrl', node: id, url });
  }

  public setVideoControls(id: NodeId, controls: boolean): this {
    this.requireId(id);
    return this.push({ kind: 'setVideoControls', node: id, controls });
  }

  public setDate(id: NodeId, date: string, displayFormat?: string): this {
    this.requireId(id);
    return this.push({ kind: 'setDate', node: id, date, displayFormat });
  }
}

export type { MentionSpec };
