// Vendored from packages/editor-ops/src/document/document-editor.ts by packages/sdk/scripts/vendor.ts; do not edit.
// IMPORTANT: this class also runs inside ai-editing-worker's QuickJS sandbox
// via a generated bundle. If you change it, regenerate the sandbox
// (`bun services/ai-editing-worker/scripts/generate-sandbox.ts`) or the AI's
// editor surface won't reflect your edits. Keep `./errors` its only runtime
// import: the generator strips imports and the SDK vendors these files.
import { EditError } from './errors';
import type {
  DatabaseQueryView,
  DocumentOp,
  Format,
  ListKind,
  MentionSpec,
  NodeId,
  NodeRef,
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

/** Where an embedded database card points: by ids, or by handles carrying `id`. */
export type DatabaseLocation =
  | { tableId: string; viewId?: string }
  | { table: { id: string }; view?: { id: string } };

/** A saved database question, such as the SDK's `SavedQuery`: `toBlock()` returns its `<m-db-query>` block. */
export type DatabaseQueryBlock = { toBlock(): string };

export type DocumentEditorOptions = {
  /** Durable ids present in the document the model was shown. */
  validIds: Iterable<NodeId>;
  /** A pool of globally-unique ids the host pre-generated (the sandbox has no
   *  good entropy of its own). Each insert pops one and stamps it as the new
   *  node's durable id, so inserted ids never collide — across concurrent
   *  writers, repeated runs, or sessions. */
  refs: string[];
};

/** Describe a non-string id argument without dumping a whole object. */
function describeBadId(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === 'object') {
    const keys = Object.keys(value as object).slice(0, 4);
    return `an object with keys [${keys.join(', ')}]`;
  }
  return `a ${typeof value} (${String(value)})`;
}

/**
 * Records edits to a document as plain-data `DocumentOp`s without touching the
 * document. Every method checks its arguments at once and throws `EditError`;
 * the host applies the whole batch afterwards. Address existing nodes by the
 * durable ids the document's XML shows; insert methods return the new node's
 * id, usable later in the same batch.
 *
 * @example
 * ```ts
 * const editor = new DocumentEditor({ validIds: ['h1', 'p1'], refs });
 * editor.replace('p1', 'Q3', 'Q4').bold('p1', 'Q4');
 * const heading = editor.insertHeadingAfter('p1', 2, 'Next steps');
 * const item = editor.insertBlockAfter(heading, {
 *   block: 'list',
 *   list: 'check',
 *   items: ['Ship it'],
 * });
 * const ops = editor.drain();
 * ```
 */
export class DocumentEditor {
  private ops: DocumentOp[] = [];
  private valid: Set<string>;
  private refs: string[];
  private refIdx = 0;

  /** Start an empty batch against a document whose node ids are `opts.validIds`. */
  constructor(opts: DocumentEditorOptions) {
    this.valid = new Set(opts.validIds);
    this.refs = opts.refs;
  }

  private push(op: DocumentOp): this {
    this.ops.push(op);
    return this;
  }

  private requireId(id: NodeId): void {
    // A non-string argument used to be stringified into the message, producing
    // `unknown id "[object Object]"` — which tells the writer nothing about what
    // it actually passed. Naming the type and the likely cause does.
    if (typeof id !== 'string') {
      throw new EditError(
        `expected a node id string but got ${describeBadId(id)}. ` +
          "Insert helpers return the new node's id directly, so use that value " +
          'as-is rather than a property of it.'
      );
    }
    if (id.length === 0) throw new EditError('node id is an empty string');
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

  /**
   * Return the ops recorded so far and start a new batch. The host calls this;
   * programs don't need to.
   */
  public drain(): DocumentOp[] {
    const out = this.ops;
    this.ops = [];
    return out;
  }

  /**
   * Turn an inline format on or off for each occurrence of `match` in node
   * `id`.
   * `scope` picks one occurrence (`{ kind: 'nth', n }`, 1-based) or all of them
   * (the default).
   */
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
  /**
   * Bold each occurrence of `match` in node `id` (or the one `scope` picks).
   */
  public bold(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'bold', true, scope);
  }

  /**
   * Italicize each occurrence of `match` in node `id` (or the one `scope`
   * picks).
   */
  public italic(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'italic', true, scope);
  }

  /**
   * Underline each occurrence of `match` in node `id` (or the one `scope`
   * picks).
   */
  public underline(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'underline', true, scope);
  }

  /**
   * Strike through each occurrence of `match` in node `id` (or the one `scope`
   * picks).
   */
  public strike(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'strike', true, scope);
  }

  /**
   * Format each occurrence of `match` in node `id` as inline code (or the one
   * `scope` picks).
   */
  public inlineCode(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'code', true, scope);
  }

  /**
   * Remove bold from each occurrence of `match` in node `id` (or the one
   * `scope` picks).
   */
  public unbold(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'bold', false, scope);
  }

  /**
   * Remove italics from each occurrence of `match` in node `id` (or the one
   * `scope` picks).
   */
  public unitalic(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'italic', false, scope);
  }

  /**
   * Remove underline from each occurrence of `match` in node `id` (or the one
   * `scope` picks).
   */
  public ununderline(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'underline', false, scope);
  }

  /**
   * Remove strikethrough from each occurrence of `match` in node `id` (or the
   * one `scope` picks).
   */
  public unstrike(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'strike', false, scope);
  }

  /**
   * Remove inline-code formatting from each occurrence of `match` in node `id`
   * (or the one `scope` picks).
   */
  public uninlineCode(id: NodeId, match: string, scope?: Scope): this {
    return this.format(id, match, 'code', false, scope);
  }

  /**
   * Strip all inline formatting from occurrences of `match` in node `id`, or
   * from the whole node when `match` is omitted.
   */
  public clearFormat(
    id: NodeId,
    match?: string,
    scope: Scope = { kind: 'all' }
  ): this {
    this.requireId(id);
    if (match !== undefined) this.requireMatch(match);
    return this.push({ kind: 'clearFormat', node: id, match, scope });
  }
  /** Strip all inline formatting from the whole of node `id`. */
  public clearAllFormat(id: NodeId): this {
    return this.clearFormat(id);
  }

  /**
   * Highlight each occurrence of `match` in node `id` (or the one `scope`
   * picks).
   */
  public highlight(
    id: NodeId,
    match: string,
    scope: Scope = { kind: 'all' }
  ): this {
    this.requireId(id);
    this.requireMatch(match);
    return this.push({ kind: 'markText', node: id, match, on: true, scope });
  }
  /**
   * Remove the highlight from each occurrence of `match` in node `id` (or the
   * one `scope` picks).
   */
  public unhighlight(
    id: NodeId,
    match: string,
    scope: Scope = { kind: 'all' }
  ): this {
    this.requireId(id);
    this.requireMatch(match);
    return this.push({ kind: 'markText', node: id, match, on: false, scope });
  }

  /**
   * Link each occurrence of `match` in node `id` to `url` (or the one `scope`
   * picks).
   */
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
  /**
   * Remove links from each occurrence of `match` in node `id`, keeping the text
   * (or the one `scope` picks).
   */
  public unlink(
    id: NodeId,
    match: string,
    scope: Scope = { kind: 'all' }
  ): this {
    this.requireId(id);
    this.requireMatch(match);
    return this.push({ kind: 'linkText', node: id, match, url: null, scope });
  }

  /** Turn an inline format on or off for all text in node `node`. */
  public formatNode(node: NodeId, format: Format, on = true): this {
    this.requireId(node);
    return this.push({ kind: 'formatNode', node, format, on });
  }
  /** Bold all text in node `node`. */
  public boldNode(node: NodeId): this {
    return this.formatNode(node, 'bold');
  }

  /** Italicize all text in node `node`. */
  public italicNode(node: NodeId): this {
    return this.formatNode(node, 'italic');
  }

  /** Underline all text in node `node`. */
  public underlineNode(node: NodeId): this {
    return this.formatNode(node, 'underline');
  }

  /** Strike through all text in node `node`. */
  public strikeNode(node: NodeId): this {
    return this.formatNode(node, 'strike');
  }

  /** Format all text in node `node` as inline code. */
  public codeNode(node: NodeId): this {
    return this.formatNode(node, 'code');
  }

  /** Strip all inline formatting from node `node`. */
  public clearNodeFormat(node: NodeId): this {
    this.requireId(node);
    return this.push({ kind: 'clearNodeFormat', node });
  }

  /**
   * Replace the text of node `id`: a block id replaces the whole block's
   * content, a text-run id replaces only that run.
   * An empty string on a run removes the run.
   */
  public setText(id: NodeId, text: string): this {
    this.requireId(id);
    return this.push({ kind: 'setText', node: id, text });
  }
  /** Replace the TeX source of the equation node `id`. */
  public setEquation(id: NodeId, tex: string): this {
    this.requireId(id);
    return this.push({ kind: 'setEquation', node: id, tex });
  }
  /**
   * Replace each occurrence of `find` in node `id` with `to`, keeping the
   * surrounding formatting (or the one `scope` picks).
   */
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
  /** Add plain text to the end of block `id`. */
  public appendText(id: NodeId, text: string): this {
    this.requireId(id);
    return this.push({ kind: 'appendText', node: id, text });
  }
  /** Add plain text to the start of block `id`. */
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

  /**
   * Turn block `id` into a paragraph, keeping its text. The block gets a new
   * id.
   */
  public convertToParagraph(id: NodeId): this {
    return this.setBlockType(id, { block: 'paragraph' });
  }

  /**
   * Turn block `id` into a heading of `level` 1-6, keeping its text. The block
   * gets a new id.
   */
  public convertToHeading(id: NodeId, level: number): this {
    if (level < 1 || level > 6)
      throw new EditError(`heading level must be 1-6, got ${level}`);
    return this.setBlockType(id, { block: 'heading', level });
  }

  /**
   * Turn block `id` into a quote, keeping its text. The block gets a new id.
   */
  public convertToQuote(id: NodeId): this {
    return this.setBlockType(id, { block: 'quote' });
  }

  /**
   * Turn block `id` into a code block in `language`, keeping its text. The
   * block gets a new id.
   */
  public convertToCodeBlock(id: NodeId, language: string): this {
    this.requireLanguage(language);
    return this.setBlockType(id, { block: 'code', language });
  }

  /** Set the language of code block `id`; same as `convertToCodeBlock`. */
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
  /**
   * Turn one block or a run of blocks into a bulleted list, one item per block.
   */
  public bulletList(idOrIds: NodeId | NodeId[]): this {
    return this.toList(idOrIds, 'bullet');
  }

  /**
   * Turn one block or a run of blocks into a numbered list, one item per block.
   */
  public numberedList(idOrIds: NodeId | NodeId[]): this {
    return this.toList(idOrIds, 'number');
  }

  /**
   * Turn one block or a run of blocks into a checklist, one unchecked item per
   * block.
   */
  public checklist(idOrIds: NodeId | NodeId[]): this {
    return this.toList(idOrIds, 'check');
  }

  /**
   * Turn block `id` (or a list) into a list of kind `list`: `bullet`, `number`,
   * or `check`.
   */
  public setListType(id: NodeId, list: ListKind): this {
    return this.toList(id, list);
  }

  /** Check the checklist item `id`. */
  public check(id: NodeId): this {
    return this.setChecked(id, true);
  }

  /** Uncheck the checklist item `id`. */
  public uncheck(id: NodeId): this {
    return this.setChecked(id, false);
  }

  /** Check or uncheck the checklist item `id`. */
  public setChecked(id: NodeId, checked: boolean): this {
    this.requireId(id);
    return this.push({ kind: 'setChecked', node: id, checked });
  }

  /**
   * Indent block or list item `id` one level; a negative `by` outdents instead.
   */
  public indent(id: NodeId, by = 1): this {
    this.requireId(id);
    return this.push({
      kind: 'setIndent',
      node: id,
      indent: by >= 0 ? 'in' : 'out',
    });
  }
  /** Outdent block or list item `id` one level. */
  public outdent(id: NodeId, by = 1): this {
    return this.indent(id, -Math.abs(by));
  }

  /** Set the indent level of block or list item `id` to `level` (0 or more). */
  public setIndent(id: NodeId, level: number): this {
    this.requireId(id);
    if (level < 0)
      throw new EditError(`indent level must be >= 0, got ${level}`);
    return this.push({ kind: 'setIndent', node: id, indent: level });
  }
  /**
   * Insert a list item with `text` after list item `id`.
   * A `list` kind other than the surrounding list's nests the item in a sublist
   * of that kind.
   */
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

  /**
   * Insert a list item with `text` before list item `id`.
   * A `list` kind other than the surrounding list's nests the item in a sublist
   * of that kind.
   */
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

  /**
   * Add an item with `text` to the end of list `listId` (the `<ul>`/`<ol>` id);
   * works on an empty list.
   */
  public appendListItem(listId: NodeId, text: string): Ref {
    this.requireId(listId);
    const ref = this.mintRef();
    this.push({ kind: 'appendListItem', ref, node: listId, text });
    return ref;
  }

  /**
   * Add an item with `text` to the start of list `listId` (the `<ul>`/`<ol>`
   * id); works on an empty list.
   */
  public prependListItem(listId: NodeId, text: string): Ref {
    this.requireId(listId);
    const ref = this.mintRef();
    this.push({ kind: 'prependListItem', ref, node: listId, text });
    return ref;
  }

  /** Remove list item `id`. */
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

  /** Insert a paragraph with `text` after block `id`. */
  public insertParagraphAfter(id: NodeId, text = ''): Ref {
    return this.insert({ block: 'paragraph', text }, { after: id });
  }

  /** Insert a paragraph with `text` before block `id`. */
  public insertParagraphBefore(id: NodeId, text = ''): Ref {
    return this.insert({ block: 'paragraph', text }, { before: id });
  }

  /**
   * Insert a heading of `level` 1-6 with `text` after block `id`.
   */
  public insertHeadingAfter(
    id: NodeId,
    level: 1 | 2 | 3 | 4 | 5 | 6,
    text = ''
  ): Ref {
    return this.insert({ block: 'heading', level, text }, { after: id });
  }

  /**
   * Insert a heading of `level` 1-6 with `text` before block `id`.
   */
  public insertHeadingBefore(
    id: NodeId,
    level: 1 | 2 | 3 | 4 | 5 | 6,
    text = ''
  ): Ref {
    return this.insert({ block: 'heading', level, text }, { before: id });
  }

  /** Insert a quote with `text` after block `id`. */
  public insertQuoteAfter(id: NodeId, text = ''): Ref {
    return this.insert({ block: 'quote', text }, { after: id });
  }

  /**
   * Insert a code block in `language` with `text` after block `id`.
   */
  public insertCodeBlockAfter(id: NodeId, language: string, text = ''): Ref {
    this.requireLanguage(language);
    return this.insert({ block: 'code', language, text }, { after: id });
  }

  /**
   * Insert the block `spec` describes after block `id`. Use
   * for lists, tables, cards and other block kinds.
   */
  public insertBlockAfter(id: NodeId, spec: NodeSpec): Ref {
    return this.insert(spec, { after: id });
  }

  /**
   * Insert the block `spec` describes before block `id`. Use
   * for lists, tables, cards and other block kinds.
   */
  public insertBlockBefore(id: NodeId, spec: NodeSpec): Ref {
    return this.insert(spec, { before: id });
  }

  /**
   * Add a paragraph with `text` at the end of the document.
   */
  public appendParagraph(text = ''): Ref {
    return this.insert({ block: 'paragraph', text }, { appendToRoot: true });
  }

  /**
   * Add a paragraph with `text` at the start of the document.
   */
  public prependParagraph(text = ''): Ref {
    return this.insert({ block: 'paragraph', text }, { prependToRoot: true });
  }

  /**
   * Add the block `spec` describes at the end of the document.
   */
  public appendBlock(spec: NodeSpec): Ref {
    return this.insert(spec, { appendToRoot: true });
  }

  /**
   * Add the block `spec` describes at the start of the document.
   */
  public prependBlock(spec: NodeSpec): Ref {
    return this.insert(spec, { prependToRoot: true });
  }

  /**
   * Move block `id` to `at`: `{ after }`, `{ before }`, `{ appendToRoot: true
   * }` or `{ prependToRoot: true }`.
   */
  public move(id: NodeId, at: Position): this {
    this.requireId(id);
    this.requireAt(at);
    return this.push({ kind: 'moveNode', node: id, at });
  }
  /** Remove node `id` and everything inside it. */
  public remove(id: NodeId): this {
    this.requireId(id);
    return this.push({ kind: 'removeNode', node: id });
  }
  /** Remove each node in `ids`. */
  public removeMany(ids: NodeId[]): this {
    for (const id of ids) this.remove(id);
    return this;
  }
  /**
   * Merge two or more blocks into the first, joining their text with
   * `separator` (a space by default).
   */
  public merge(ids: NodeId[], separator = ' '): this {
    if (ids.length < 2)
      throw new EditError('merge requires at least two blocks');
    for (const id of ids) this.requireId(id);
    return this.push({ kind: 'mergeBlocks', nodes: ids, separator });
  }
  /**
   * Insert a table after block `id`. `rows[0]` is the header
   * row; every row needs the same number of cells.
   */
  public insertTableAfter(id: NodeId, rows: string[][]): Ref {
    return this.buildTable(rows, { after: id });
  }

  /**
   * Insert a table before block `id`. `rows[0]` is the header
   * row; every row needs the same number of cells.
   */
  public insertTableBefore(id: NodeId, rows: string[][]): Ref {
    return this.buildTable(rows, { before: id });
  }

  /**
   * Add a table at the end of the document. `rows[0]` is the
   * header row; every row needs the same number of cells.
   */
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

  /**
   * Replace the text of the cell at `row`, `col` (0-based, row 0 is the header)
   * in table `table`. Pass the table id, not a row or cell id.
   */
  public setCell(table: NodeId, row: number, col: number, text: string): this {
    this.requireId(table);
    this.requireCell(row, col);
    return this.push({ kind: 'setCell', table, row, col, text });
  }
  /**
   * Add an empty row to table `table` at index `at`, or at the end when
   * omitted.
   */
  public addRow(table: NodeId, at?: number): this {
    this.requireId(table);
    return this.push({ kind: 'addRow', table, at });
  }
  /**
   * Add an empty column to table `table` at index `at`, or at the end when
   * omitted.
   */
  public addColumn(table: NodeId, at?: number): this {
    this.requireId(table);
    return this.push({ kind: 'addColumn', table, at });
  }
  /** Remove row `row` (0-based) from table `table`. */
  public removeRow(table: NodeId, row: number): this {
    this.requireId(table);
    this.requireCell(row, 0);
    return this.push({ kind: 'removeRow', table, row });
  }
  /** Remove column `col` (0-based) from table `table`. */
  public removeColumn(table: NodeId, col: number): this {
    this.requireId(table);
    this.requireCell(0, col);
    return this.push({ kind: 'removeColumn', table, col });
  }
  private requireCell(row: number, col: number): void {
    if (row < 0 || col < 0)
      throw new EditError(`cell indices must be >= 0, got (${row}, ${col})`);
  }

  /** Insert a horizontal divider after block `afterId`. */
  public insertDivider(afterId: NodeId): Ref {
    return this.insert({ block: 'divider' }, { after: afterId });
  }

  /** Insert an image after block `afterId`. */
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

  /** Insert a video after block `afterId`. */
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

  /**
   * Insert a block equation with TeX `tex` after block `afterId`.
   */
  public insertEquation(afterId: NodeId, tex: string): Ref {
    return this.insert({ block: 'equation', tex }, { after: afterId });
  }

  /**
   * Insert an inline equation with TeX `tex` at character offset `at` of block
   * `blockId`.
   */
  public insertInlineEquation(blockId: NodeId, at: number, tex: string): Ref {
    return this.insertInline(blockId, at, { inline: 'equation', tex });
  }

  /**
   * Insert plain text right after an inline node such as a mention, date or
   * equation.
   */
  public insertTextAfterInline(inlineRef: NodeRef, text: string): this {
    return this.push({
      kind: 'insertTextAfterInline',
      inline: inlineRef,
      text,
    });
  }

  /**
   * Insert a line break at character offset `at` of block `blockId`.
   */
  public insertLineBreak(blockId: NodeId, at: number): Ref {
    return this.insertInline(blockId, at, { inline: 'linebreak' });
  }

  /**
   * Insert a date chip for ISO `isoDate` at character offset `at` of block
   * `blockId`.
   */
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

  /**
   * Insert a date chip for ISO `isoDate` at character offset `at` of block
   * `blockId`; same as `insertDate`.
   */
  public mentionDate(
    blockId: NodeId,
    at: number,
    isoDate: string,
    displayFormat?: string
  ): Ref {
    return this.insertDate(blockId, at, isoDate, displayFormat);
  }
  private insertInline(id: NodeId, at: number, spec: NodeSpec): Ref {
    this.requireId(id);
    if (at < 0) throw new EditError(`inline offset must be >= 0, got ${at}`);
    const ref = this.mintRef();
    this.push({ kind: 'insertInline', ref, node: id, at, spec });
    return ref;
  }

  /**
   * Insert the mention `mention` describes at character offset `at` of block
   * `blockId`.
   */
  public insertMention(blockId: NodeId, at: number, mention: MentionSpec): Ref {
    return this.insertInline(blockId, at, { inline: 'mention', mention });
  }

  /**
   * Mention a Macro user at character offset `at` of block `blockId`.
   */
  public mentionUser(
    blockId: NodeId,
    at: number,
    entity: { userId: string; email: string }
  ): Ref {
    return this.insertMention(blockId, at, { kind: 'user', ...entity });
  }

  /**
   * Mention a contact or company at character offset `at` of block `blockId`
   *.
   */
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

  /**
   * Mention a group alias at character offset `at` of block `blockId`.
   */
  public mentionGroup(
    blockId: NodeId,
    at: number,
    entity: { groupAlias: string }
  ): Ref {
    return this.insertMention(blockId, at, { kind: 'group', ...entity });
  }

  /**
   * Mention a document at character offset `at` of block `blockId`.
   */
  public mentionDocument(
    blockId: NodeId,
    at: number,
    entity: {
      documentId: string;
      documentName: string;
      blockName: string;
      blockParams?: Record<string, string>;
    }
  ): Ref {
    return this.insertMention(blockId, at, { kind: 'document', ...entity });
  }

  /**
   * Mention an agent session at character offset `at` of block `blockId`.
   */
  public mentionAgentSession(
    blockId: NodeId,
    at: number,
    entity: { id: string; label?: string; expanded?: boolean }
  ): Ref {
    return this.insertMention(blockId, at, {
      kind: 'agent_session',
      ...entity,
    });
  }

  /**
   * Mention a pull request at character offset `at` of block `blockId`.
   */
  public mentionPullRequest(
    blockId: NodeId,
    at: number,
    entity: { id: string; label?: string }
  ): Ref {
    return this.insertMention(blockId, at, { kind: 'pr', ...entity });
  }

  /**
   * Mention a booking link at character offset `at` of block `blockId`.
   */
  public mentionBookingLink(
    blockId: NodeId,
    at: number,
    entity: {
      profileId: string;
      url: string;
      slug?: string;
      label?: string;
    }
  ): Ref {
    return this.insertMention(blockId, at, { kind: 'booking_link', ...entity });
  }

  /**
   * Mention a tag (a property option) at character offset `at` of block
   * `blockId`.
   */
  public mentionTag(
    blockId: NodeId,
    at: number,
    entity: {
      optionId: string;
      propertyDefinitionId: string;
      scope: 'user' | 'team';
      name: string;
      color?: string;
    }
  ): Ref {
    return this.insertMention(blockId, at, { kind: 'tag', ...entity });
  }

  /** Set the alt text of image `id`. */
  public setImageAlt(id: NodeId, alt: string): this {
    this.requireId(id);
    return this.push({ kind: 'setImageAlt', node: id, alt });
  }

  /** Point image `id` at `url`. */
  public setImageUrl(id: NodeId, url: string): this {
    this.requireId(id);
    return this.push({ kind: 'setImageUrl', node: id, url });
  }

  /** Point video `id` at `url`. */
  public setVideoUrl(id: NodeId, url: string): this {
    this.requireId(id);
    return this.push({ kind: 'setVideoUrl', node: id, url });
  }

  /** Show or hide the playback controls of video `id`. */
  public setVideoControls(id: NodeId, controls: boolean): this {
    this.requireId(id);
    return this.push({ kind: 'setVideoControls', node: id, controls });
  }

  /**
   * Change date chip `id` to ISO `date`, optionally with a new display format.
   */
  public setDate(id: NodeId, date: string, displayFormat?: string): this {
    this.requireId(id);
    return this.push({ kind: 'setDate', node: id, date, displayFormat });
  }

  private queryBlock(query: string | DatabaseQueryBlock): string {
    const block =
      typeof query === 'object' &&
      query !== null &&
      typeof query.toBlock === 'function'
        ? query.toBlock()
        : query;
    if (typeof block !== 'string' || !block.includes('<m-db-query>')) {
      throw new EditError(
        "pass the saved question's <m-db-query>…</m-db-query> block from the request, verbatim"
      );
    }
    return block;
  }

  /**
   * Insert a saved database question after block `id` as a live number, table
   * or chart.
   * `query` is a saved query (anything with `toBlock()`) or its `<m-db-query>`
   * block, verbatim.
   */
  public insertDatabaseQueryAfter(
    id: NodeId,
    query: string | DatabaseQueryBlock
  ): Ref {
    const block = this.queryBlock(query);
    return this.insert(
      { block: 'database-query', query: block },
      { after: id }
    );
  }

  /**
   * Insert a saved database question before block `id` as a live number, table
   * or chart.
   * `query` is a saved query (anything with `toBlock()`) or its `<m-db-query>`
   * block, verbatim.
   */
  public insertDatabaseQueryBefore(
    id: NodeId,
    query: string | DatabaseQueryBlock
  ): Ref {
    const block = this.queryBlock(query);
    return this.insert(
      { block: 'database-query', query: block },
      { before: id }
    );
  }

  /**
   * Add a saved database question at the end of the document as a live number,
   * table or chart.
   * `query` is a saved query (anything with `toBlock()`) or its `<m-db-query>`
   * block, verbatim.
   */
  public appendDatabaseQuery(query: string | DatabaseQueryBlock): Ref {
    const block = this.queryBlock(query);
    return this.insert(
      { block: 'database-query', query: block },
      { appendToRoot: true }
    );
  }

  /**
   * Insert a scalar saved database question inside a sentence, at character
   * offset `at` of block `blockId`.
   * `query` is a saved query (anything with `toBlock()`) or its `<m-db-query>`
   * block, verbatim.
   */
  public insertInlineDatabaseQuery(
    blockId: NodeId,
    at: number,
    query: string | DatabaseQueryBlock
  ): Ref {
    const block = this.queryBlock(query);
    return this.insertInline(blockId, at, {
      inline: 'database-query',
      query: block,
    });
  }

  /**
   * Change how database question `id` is shown (display mode, title, chart,
   * height); `null` clears a field.
   * The question and its SQL never change here; insert a new question instead.
   */
  public setDatabaseQueryView(id: NodeId, view: DatabaseQueryView): this {
    this.requireId(id);
    if (!view || typeof view !== 'object' || !Object.keys(view).length) {
      throw new EditError(
        'pass at least one of displayMode, title, chart, or height'
      );
    }
    return this.push({ kind: 'setDatabaseQueryView', node: id, view });
  }

  /**
   * Show another table, and optionally view, in the embedded database card
   * `id`. Pass ids (`{ tableId, viewId }`) or handles (`{ table, view }`), such
   * as an SDK `DatabaseTable` and `DatabaseView`.
   */
  public setDatabaseLocation(id: NodeId, location: DatabaseLocation): this {
    this.requireId(id);
    if (!location || typeof location !== 'object') {
      throw new EditError('setDatabaseLocation needs a table');
    }
    const tableId = 'table' in location ? location.table?.id : location.tableId;
    const viewId = 'table' in location ? location.view?.id : location.viewId;
    if (typeof tableId !== 'string' || !tableId) {
      throw new EditError('setDatabaseLocation needs a table');
    }
    return this.push({
      kind: 'setDatabaseLocation',
      node: id,
      tableId,
      viewId,
    });
  }
}

export type { MentionSpec };
