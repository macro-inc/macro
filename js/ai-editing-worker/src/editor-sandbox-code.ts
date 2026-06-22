// Plain-JS version of DocumentEditor + EditError as a string, for QuickJS execution.
// Keep in sync with lexical-core/ai-editing/editor/document-editor.ts.
export const SANDBOX_CODE = `
class EditError extends Error {
  constructor(msg) { super(msg); this.name = 'EditError'; }
}

let refSeq = 0;

class DocumentEditor {
  constructor(validIds) {
    this.ops = [];
    this.valid = new Set(validIds);
  }

  _push(op) { this.ops.push(op); return this; }
  _requireId(id) { if (!this.valid.has(id)) throw new EditError('unknown id "' + id + '"'); }
  _requireMatch(match) { if (match.length === 0) throw new EditError('match string is empty'); }
  _mintRef() { const ref = 'ref-' + (++refSeq); this.valid.add(ref); return ref; }
  _requireAt(at) {
    if ('after' in at) this._requireId(at.after);
    else if ('before' in at) this._requireId(at.before);
  }
  _requireCell(row, col) {
    if (row < 0 || col < 0) throw new EditError('cell indices must be >= 0, got (' + row + ', ' + col + ')');
  }

  drain() { const out = this.ops; this.ops = []; return out; }

  format(id, match, format, on, scope) {
    if (on === undefined) on = true;
    if (scope === undefined) scope = { all: true };
    this._requireId(id); this._requireMatch(match);
    return this._push({ kind: 'formatText', id, match, format, on, scope });
  }
  bold(id, match, scope) { return this.format(id, match, 'bold', true, scope); }
  italic(id, match, scope) { return this.format(id, match, 'italic', true, scope); }
  underline(id, match, scope) { return this.format(id, match, 'underline', true, scope); }
  strike(id, match, scope) { return this.format(id, match, 'strike', true, scope); }
  inlineCode(id, match, scope) { return this.format(id, match, 'code', true, scope); }
  unbold(id, match, scope) { return this.format(id, match, 'bold', false, scope); }
  unitalic(id, match, scope) { return this.format(id, match, 'italic', false, scope); }
  ununderline(id, match, scope) { return this.format(id, match, 'underline', false, scope); }
  unstrike(id, match, scope) { return this.format(id, match, 'strike', false, scope); }
  uninlineCode(id, match, scope) { return this.format(id, match, 'code', false, scope); }

  clearFormat(id, match, scope) {
    if (scope === undefined) scope = { all: true };
    this._requireId(id);
    if (match !== undefined) this._requireMatch(match);
    return this._push({ kind: 'clearFormat', id, match, scope });
  }
  clearAllFormat(id) { return this.clearFormat(id, undefined, { all: true }); }

  highlight(id, match, scope) {
    if (scope === undefined) scope = { all: true };
    this._requireId(id); this._requireMatch(match);
    return this._push({ kind: 'markText', id, match, on: true, scope });
  }
  unhighlight(id, match, scope) {
    if (scope === undefined) scope = { all: true };
    this._requireId(id); this._requireMatch(match);
    return this._push({ kind: 'markText', id, match, on: false, scope });
  }

  link(id, match, url, scope) {
    if (scope === undefined) scope = { all: true };
    this._requireId(id); this._requireMatch(match);
    return this._push({ kind: 'linkText', id, match, url, scope });
  }
  unlink(id, match, scope) {
    if (scope === undefined) scope = { all: true };
    this._requireId(id); this._requireMatch(match);
    return this._push({ kind: 'linkText', id, match, url: null, scope });
  }

  formatNode(textId, format, on) {
    if (on === undefined) on = true;
    this._requireId(textId);
    return this._push({ kind: 'formatNode', textId, format, on });
  }
  boldNode(textId) { return this.formatNode(textId, 'bold'); }
  italicNode(textId) { return this.formatNode(textId, 'italic'); }
  underlineNode(textId) { return this.formatNode(textId, 'underline'); }
  strikeNode(textId) { return this.formatNode(textId, 'strike'); }
  codeNode(textId) { return this.formatNode(textId, 'code'); }
  clearNodeFormat(textId) {
    this._requireId(textId);
    return this._push({ kind: 'clearNodeFormat', textId });
  }

  setText(id, text) { this._requireId(id); return this._push({ kind: 'setText', id, text }); }
  replace(id, find, to, scope) {
    if (scope === undefined) scope = { all: true };
    this._requireId(id);
    if (find.length === 0) throw new EditError('find string is empty');
    return this._push({ kind: 'replaceText', id, find, to, scope });
  }
  appendText(id, text) { this._requireId(id); return this._push({ kind: 'appendText', id, text }); }
  prependText(id, text) { this._requireId(id); return this._push({ kind: 'prependText', id, text }); }

  _setBlockType(id, block, extra) {
    this._requireId(id);
    return this._push(Object.assign({ kind: 'setBlockType', id, block }, extra));
  }
  makeParagraph(id) { return this._setBlockType(id, 'paragraph', {}); }
  makeHeading(id, level) {
    if (level < 1 || level > 6) throw new EditError('heading level must be 1-6, got ' + level);
    return this._setBlockType(id, 'heading', { level });
  }
  makeQuote(id) { return this._setBlockType(id, 'quote', {}); }
  makeCodeBlock(id, language) { return this._setBlockType(id, 'code', language ? { language } : {}); }

  _toList(idOrIds, list) {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    if (ids.length === 0) throw new EditError('list requires at least one block');
    for (const id of ids) this._requireId(id);
    return this._push({ kind: 'setListType', ids, list });
  }
  bulletList(idOrIds) { return this._toList(idOrIds, 'bullet'); }
  numberedList(idOrIds) { return this._toList(idOrIds, 'number'); }
  checklist(idOrIds) { return this._toList(idOrIds, 'check'); }
  setListType(id, list) { return this._toList(id, list); }

  check(id) { return this.setChecked(id, true); }
  uncheck(id) { return this.setChecked(id, false); }
  setChecked(id, checked) { this._requireId(id); return this._push({ kind: 'setChecked', id, checked }); }

  indent(id, by) {
    if (by === undefined) by = 1;
    this._requireId(id);
    return this._push({ kind: 'setIndent', id, indent: by >= 0 ? 'in' : 'out' });
  }
  outdent(id, by) { return this.indent(id, -(by === undefined ? 1 : Math.abs(by))); }
  setIndent(id, level) {
    this._requireId(id);
    if (level < 0) throw new EditError('indent level must be >= 0, got ' + level);
    return this._push({ kind: 'setIndent', id, indent: level });
  }
  sortList(id, order) {
    if (order === undefined) order = 'asc';
    this._requireId(id);
    return this._push({ kind: 'sortList', id, order });
  }

  _insert(spec, at) {
    this._requireAt(at);
    const ref = this._mintRef();
    this._push({ kind: 'insertBlock', ref, spec, at });
    return ref;
  }
  insertParagraphAfter(id, text) { return this._insert({ block: 'paragraph', text: text || '' }, { after: id }); }
  insertParagraphBefore(id, text) { return this._insert({ block: 'paragraph', text: text || '' }, { before: id }); }
  insertHeadingAfter(id, level, text) { return this._insert({ block: 'heading', level, text: text || '' }, { after: id }); }
  insertHeadingBefore(id, level, text) { return this._insert({ block: 'heading', level, text: text || '' }, { before: id }); }
  insertQuoteAfter(id, text) { return this._insert({ block: 'quote', text: text || '' }, { after: id }); }
  insertCodeBlockAfter(id, language, text) { return this._insert({ block: 'code', language, text: text || '' }, { after: id }); }
  insertBlockAfter(id, spec) { return this._insert(spec, { after: id }); }
  insertBlockBefore(id, spec) { return this._insert(spec, { before: id }); }
  appendParagraph(text) { return this._insert({ block: 'paragraph', text: text || '' }, { appendToRoot: true }); }
  prependParagraph(text) { return this._insert({ block: 'paragraph', text: text || '' }, { prependToRoot: true }); }
  appendBlock(spec) { return this._insert(spec, { appendToRoot: true }); }
  prependBlock(spec) { return this._insert(spec, { prependToRoot: true }); }

  move(id, at) { this._requireId(id); this._requireAt(at); return this._push({ kind: 'moveBlock', id, at }); }
  remove(id) { this._requireId(id); return this._push({ kind: 'removeBlock', id }); }
  removeMany(ids) { for (const id of ids) this.remove(id); return this; }
  merge(ids, separator) {
    if (separator === undefined) separator = ' ';
    if (ids.length < 2) throw new EditError('merge requires at least two blocks');
    for (const id of ids) this._requireId(id);
    return this._push({ kind: 'mergeBlocks', ids, separator });
  }
  split(id, atText) {
    this._requireId(id); this._requireMatch(atText);
    return this._push({ kind: 'splitBlock', id, atText });
  }

  insertTableAfter(id, rows) { return this._insert({ block: 'table', rows }, { after: id }); }
  insertTableBefore(id, rows) { return this._insert({ block: 'table', rows }, { before: id }); }
  appendTable(rows) { return this._insert({ block: 'table', rows }, { appendToRoot: true }); }
  setCell(table, row, col, content) {
    this._requireId(table); this._requireCell(row, col);
    return this._push({ kind: 'setCell', table, row, col, content });
  }
  addRow(table, at) { this._requireId(table); return this._push({ kind: 'addRow', table, at }); }
  addColumn(table, at) { this._requireId(table); return this._push({ kind: 'addColumn', table, at }); }
  removeRow(table, row) { this._requireId(table); this._requireCell(row, 0); return this._push({ kind: 'removeRow', table, row }); }
  removeColumn(table, col) { this._requireId(table); this._requireCell(0, col); return this._push({ kind: 'removeColumn', table, col }); }

  _insertInline(id, at, spec) {
    this._requireId(id);
    if (at < 0) throw new EditError('inline offset must be >= 0, got ' + at);
    const ref = this._mintRef();
    this._push({ kind: 'insertInline', ref, id, at, spec });
    return ref;
  }
  insertDivider(afterId) { return this._insert({ block: 'divider' }, { after: afterId }); }
  insertImage(afterId, img) { return this._insert(Object.assign({ block: 'image' }, img), { after: afterId }); }
  insertVideo(afterId, vid) { return this._insert(Object.assign({ block: 'video' }, vid), { after: afterId }); }
  insertEquation(afterId, tex) { return this._insert({ block: 'equation', tex }, { after: afterId }); }
  insertInlineEquation(blockId, at, tex) { return this._insertInline(blockId, at, { inline: 'equation', tex }); }
  insertLineBreak(blockId, at) { return this._insertInline(blockId, at, { inline: 'linebreak' }); }
  insertDate(blockId, at, isoDate, displayFormat) { return this._insertInline(blockId, at, { inline: 'date', date: isoDate, displayFormat }); }
}
`;
