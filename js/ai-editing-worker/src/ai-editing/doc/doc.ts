/**
 * The one place this system touches real Lexical (and, via `propagate`, Loro).
 * `Doc` implements both `DocReader` (reads to plan) and `DocWriter` (atomic
 * edits), resolving every `NodeRef` through the durable id ↔ node-key map and
 * delegating the actual mutations to the existing `ai-toolkit` `$`-helpers. A
 * shared `refs` map turns an inserted node's placeholder ref into its minted id,
 * so later reads/edits in the same run resolve it.
 */
import { $createLineBreakNode, $createParagraphNode, $createTextNode, $getRoot, $isElementNode, type ElementNode, type LexicalNode, type TextNode } from 'lexical';
import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from '@lexical/rich-text';
import { $createCodeNode } from '@lexical/code';
import { $createListItemNode, $createListNode, $isListNode, type ListType } from '@lexical/list';
import { $createTableCellNode, $createTableRowNode, $isTableCellNode, $isTableNode, $isTableRowNode, TableCellHeaderStates, type TableNode } from '@lexical/table';
import { match } from 'ts-pattern';
import { $createHorizontalRuleNode } from '../../../../lexical-core/nodes/HorizontalRuleNode';
import { $createEquationNode } from '../../../../lexical-core/nodes/EquationNode';
import { $createImageNode, ImageNode } from '../../../../lexical-core/nodes/ImageNode';
import { $createVideoNode, VideoNode } from '../../../../lexical-core/nodes/VideoNode';
import { $createDateMentionNode, $isDateMentionNode } from '../../../../lexical-core/nodes/DateMentionNode';
import { $createUserMentionNode } from '../../../../lexical-core/nodes/UserMentionNode';
import { $createContactMentionNode } from '../../../../lexical-core/nodes/ContactMentionNode';
import { $createGroupMentionNode } from '../../../../lexical-core/nodes/GroupMentionNode';
import { $createDocumentMentionNode } from '../../../../lexical-core/nodes/DocumentMentionNode';
import { $getId, $updateAllNodeIds } from '../../../../lexical-core/plugins/nodeIdPlugin';
import {
  $appendText,
  $clearFormat,
  $formatTextInBlock,
  $highlightInBlock,
  $unhighlightInBlock,
  $prependText,
  $replaceString,
  $stripFormat,
  $unwrapFromLink,
  $wrapInLink,
} from '../ai-toolkit/inline';
import { $appendBlock, $mergeBlocks, $moveBlock, $prependBlock, $setText, $splitBlock, type BlockData } from '../ai-toolkit/blocks';
import { $setListType, $sortList, $toggleList } from '../ai-toolkit/lists';
import { $modifyNode } from '../ai-toolkit/modify';
import { $setCell, $table } from '../ai-toolkit/tables';
import { $blockById, $byId, $textById } from '../ai-toolkit/locate';
import { collectTextNodes } from '../ai-toolkit/tree';
import type { Session } from '../ai-toolkit/session';
import { EditError } from '../editor/errors';
import type { Format, ListKind, NodeRef, NodeSpec, Offset, Position, Scope } from '../editor/ops';
import type { DocReader, DocWriter, Match } from './interfaces';

const FORMAT_BIT: Record<Format, 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code'> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strikethrough',
  code: 'code',
};

export class Doc implements DocReader, DocWriter {
  private refs = new Map<string, string>();

  constructor(
    private readonly s: Session,
    /** Push the new state out (snapshot to mirror to Loro). Noop in unit tests. */
    private readonly propagate: () => void = () => {}
  ) {}

  private id(node: NodeRef): string {
    return this.refs.get(node) ?? node;
  }

  /** Resolve a placeholder ref to its minted id (identity if not a ref). Used by
   *  the executor to point awareness at the real node once an insert has run. */
  public resolveRef(node: NodeRef): NodeRef {
    return this.id(node);
  }

  private read<T>(fn: () => T): T {
    return this.s.editor.getEditorState().read(fn);
  }

  /** One discrete update; partial work is discarded on throw, errors surface as
   *  EditError, and the edit propagates to the live doc immediately so changes
   *  (and typing) stream in as they happen. */
  private tx(fn: () => void): void {
    const before = this.s.editor.getEditorState();
    try {
      this.s.editor.update(fn, { discrete: true });
    } catch (e) {
      this.s.editor.setEditorState(before);
      this.s.editor.update(() => $updateAllNodeIds(this.s.ids), { discrete: true });
      throw e instanceof EditError ? e : new EditError((e as Error).message);
    }
    this.propagate();
  }

  private block(node: NodeRef): ElementNode {
    return $blockById(this.s, this.id(node));
  }

  public textLength(node: NodeRef): number {
    return this.read(() => $byId(this.s, this.id(node)).getTextContent().length);
  }

  public locate(id: string, match: string, scope?: Scope): Match[] {
    return this.read(() => {
      const block = this.block(id);
      const all = scope?.all === true;
      const nth = scope?.nth;
      const out: Match[] = [];
      let occ = 0;
      for (const tn of collectTextNodes(block)) {
        const content = tn.getTextContent();
        const tid = $getId(tn);
        let idx = content.indexOf(match);
        while (idx !== -1) {
          occ++;
          const take = all || (nth == null ? occ === 1 : occ === nth);
          if (take && tid) out.push({ node: tid, start: idx, end: idx + match.length });
          idx = content.indexOf(match, idx + match.length);
        }
      }
      return out;
    });
  }

  public cellNode(table: string, row: number, col: number): NodeRef {
    return this.read(() => {
      const cell = this.cell(this.id(table), row, col);
      const content = cell.getChildren().find($isElementNode) ?? cell;
      const cid = $getId(content as LexicalNode);
      if (!cid) throw new EditError(`cell [${row}, ${col}] has no addressable content`);
      return cid;
    });
  }

  private cell(tableRef: string, row: number, col: number) {
    const table = resolveTable($byId(this.s, tableRef));
    const cell = table.getChildren().filter($isTableRowNode)[row]?.getChildren().filter($isTableCellNode)[col];
    if (!cell) throw new EditError(`no cell at [${row}, ${col}]`);
    return cell;
  }

  public insertText(node: NodeRef, at: Offset, text: string): void {
    this.tx(() => insertTextAt(this.block(node), at, text));
  }

  public removeText(node: NodeRef, at: Offset, len: number): void {
    this.tx(() => removeTextAt(this.block(node), at, len));
  }

  public setText(node: NodeRef, text: string): void {
    this.tx(() => $setText(this.block(node), text));
  }

  public appendText(node: NodeRef, text: string): void {
    this.tx(() => $appendText(this.block(node), text));
  }

  public prependText(node: NodeRef, text: string): void {
    this.tx(() => $prependText(this.block(node), text));
  }

  public replaceText(node: NodeRef, find: string, to: string, scope: Scope): void {
    this.tx(() => $replaceString(this.block(node), find, to, scope));
  }

  public formatText(node: NodeRef, match: string, format: Format, on: boolean, scope: Scope): void {
    this.tx(() => {
      const block = this.block(node);
      if (on) $formatTextInBlock(block, match, format, scope);
      else $clearFormat(block, match, format, scope);
    });
  }

  public clearFormat(node: NodeRef, match: string | undefined, scope: Scope): void {
    this.tx(() => {
      const block = this.block(node);
      if (match === undefined) $stripFormat(block);
      else $clearFormat(block, match, undefined, scope);
    });
  }

  public markText(node: NodeRef, match: string, on: boolean, scope: Scope): void {
    this.tx(() => {
      if (on) $highlightInBlock(this.block(node), match, scope);
      else $unhighlightInBlock(this.block(node), match, scope);
    });
  }

  public linkText(node: NodeRef, match: string, url: string | null, scope: Scope): void {
    this.tx(() => {
      if (url !== null) $wrapInLink(this.block(node), match, url, scope);
      else $unwrapFromLink(this.block(node), match, scope);
    });
  }

  public formatNode(node: NodeRef, format: Format, on: boolean): void {
    this.tx(() => {
      const tn = $textById(this.s, this.id(node));
      const bit = FORMAT_BIT[format];
      if (tn.hasFormat(bit) !== on) tn.toggleFormat(bit);
    });
  }

  public clearNodeFormat(node: NodeRef): void {
    this.tx(() => $textById(this.s, this.id(node)).setFormat(0));
  }

  public setEquation(node: NodeRef, tex: string): void {
    this.tx(() => $modifyNode(this.s, this.id(node), { op: 'equation', tex }));
  }

  public setBlockType(node: NodeRef, block: 'paragraph' | 'heading' | 'quote' | 'code', opts: { level?: number; language?: string }): void {
    const data: BlockData =
      block === 'heading' ? { type: 'heading', level: opts.level ?? 1 } :
      block === 'code'    ? { type: 'code', language: opts.language } :
                            { type: block };
    this.tx(() => $modifyNode(this.s, this.id(node), { op: 'blockType', block: data }));
  }

  public setListType(nodes: NodeRef[], list: ListKind): void {
    this.tx(() => {
      const resolved = nodes.map((n) => $byId(this.s, this.id(n)));
      const first = resolved[0];
      if (first && first.getType() === 'listitem') $setListType(first, list, this.s);
      else $toggleList(resolved, list);
    });
  }

  public setChecked(node: NodeRef, checked: boolean): void {
    this.tx(() => $modifyNode(this.s, this.id(node), { op: 'checked', checked }));
  }

  public setIndent(node: NodeRef, indent: number | 'in' | 'out'): void {
    this.tx(() => $modifyNode(this.s, this.id(node), { op: 'indent', indent }));
  }

  public sortList(node: NodeRef, order: 'asc' | 'desc'): void {
    this.tx(() => $sortList($byId(this.s, this.id(node)), { order }));
  }

  public appendListItem(ref: string, node: NodeRef, checked?: boolean): void {
    this.tx(() => {
      const list = $byId(this.s, this.id(node));
      if (!$isListNode(list)) throw new EditError('appendListItem target is not a list');
      const li = $createListItemNode(checked);
      list.append(li);
      this.assignRef(ref, li);
    });
  }

  public insertNode(ref: string, spec: NodeSpec, at: Position): void {
    this.tx(() => {
      // `insertNode` is for block specs; inline specs go through `insertInline`.
      if ('inline' in spec) throw new EditError('insertNode requires a block spec');
      let node: LexicalNode = buildNode(spec);
      // Most blocks are ElementNodes or block decorators (divider/image/video).
      // A few block specs build a structurally-inline decorator (equation) — wrap
      // it in a paragraph so it stands as its own block.
      if (node.isInline()) {
        const p = $createParagraphNode();
        p.append(node);
        node = p;
      }
      this.place(node, at);
      this.assignRef(ref, node);
    });
  }

  public insertInline(ref: string, node: NodeRef, at: Offset, spec: NodeSpec): void {
    this.tx(() => {
      const block = this.block(node);
      const inline = buildNode(spec);
      insertInlineAt(block, at, inline);
      this.assignRef(ref, inline);
    });
  }

  public moveNode(node: NodeRef, at: Position): void {
    this.tx(() => {
      const block = this.block(node);
      if ('after' in at) $moveBlock(block, { afterId: this.id(at.after) }, this.s);
      else if ('before' in at) $moveBlock(block, { beforeId: this.id(at.before) }, this.s);
      else {
        block.remove();
        if ('appendToRoot' in at) $appendBlock(block);
        else $prependBlock(block);
      }
    });
  }

  public removeNode(node: NodeRef): void {
    this.tx(() => $byId(this.s, this.id(node)).remove());
  }

  public mergeBlocks(nodes: NodeRef[], separator: string): void {
    this.tx(() => $mergeBlocks(nodes.map((n) => $byId(this.s, this.id(n))), separator));
  }

  public splitBlock(node: NodeRef, atText: string): void {
    this.tx(() => $splitBlock(this.block(node), atText));
  }

  public setCell(table: NodeRef, row: number, col: number, text: string): void {
    this.tx(() => $setCell($byId(this.s, this.id(table)), row, col, text));
  }

  public addRow(table: NodeRef, at?: number): void {
    this.tx(() => {
      const t = resolveTable($byId(this.s, this.id(table)));
      const rows = t.getChildren().filter($isTableRowNode);
      const cols = rows[0]?.getChildren().filter($isTableCellNode).length ?? 1;
      const row = $createTableRowNode();
      for (let c = 0; c < cols; c++) row.append(emptyCell(false));
      if (at == null || at >= rows.length) t.append(row);
      else rows[at]!.insertBefore(row);
    });
  }

  public addColumn(table: NodeRef, at?: number): void {
    this.tx(() => {
      const t = resolveTable($byId(this.s, this.id(table)));
      t.getChildren().filter($isTableRowNode).forEach((row, ri) => {
        const cells = row.getChildren().filter($isTableCellNode);
        const cell = emptyCell(ri === 0);
        if (at == null || at >= cells.length) row.append(cell);
        else cells[at]!.insertBefore(cell);
      });
    });
  }

  public removeRow(table: NodeRef, row: number): void {
    this.tx(() => {
      const t = resolveTable($byId(this.s, this.id(table)));
      t.getChildren().filter($isTableRowNode)[row]?.remove();
    });
  }

  public removeColumn(table: NodeRef, col: number): void {
    this.tx(() => {
      const t = resolveTable($byId(this.s, this.id(table)));
      for (const row of t.getChildren().filter($isTableRowNode)) {
        row.getChildren().filter($isTableCellNode)[col]?.remove();
      }
    });
  }

  public setImageAlt(node: NodeRef, alt: string): void {
    this.tx(() => {
      const n = $byId(this.s, this.id(node));
      if (!(n instanceof ImageNode)) throw new EditError(`{${node}} is not an image`);
      n.setAlt(alt);
    });
  }

  public setImageUrl(node: NodeRef, url: string): void {
    this.tx(() => {
      const n = $byId(this.s, this.id(node));
      if (!(n instanceof ImageNode)) throw new EditError(`{${node}} is not an image`);
      n.setUrl(url);
    });
  }

  public setVideoUrl(node: NodeRef, url: string): void {
    this.tx(() => {
      const n = $byId(this.s, this.id(node));
      if (!(n instanceof VideoNode)) throw new EditError(`{${node}} is not a video`);
      n.setUrl(url);
    });
  }

  public setVideoControls(node: NodeRef, controls: boolean): void {
    this.tx(() => {
      const n = $byId(this.s, this.id(node));
      if (!(n instanceof VideoNode)) throw new EditError(`{${node}} is not a video`);
      n.setControls(controls);
    });
  }

  public setDate(node: NodeRef, date: string, displayFormat?: string): void {
    this.tx(() => {
      const n = $byId(this.s, this.id(node));
      if (!$isDateMentionNode(n)) throw new EditError(`{${node}} is not a date mention`);
      n.setDate(date);
      n.setDisplayFormat(displayFormat ?? date);
    });
  }

  private place(node: LexicalNode, at: Position): void {
    // Node-level insertion (not the ElementNode-typed $-helpers) so decorator
    // blocks — divider/image/video/equation — place correctly too.
    if ('after' in at) this.block(at.after).insertAfter(node);
    else if ('before' in at) this.block(at.before).insertBefore(node);
    else if ('appendToRoot' in at) $getRoot().append(node);
    else {
      const first = $getRoot().getFirstChild();
      if (first) first.insertBefore(node);
      else $getRoot().append(node);
    }
  }

  /** Mint/refresh ids for the freshly inserted subtree and record ref to id. */
  private assignRef(ref: string, node: LexicalNode): void {
    $updateAllNodeIds(this.s.ids);
    const id = $getId(node);
    if (!id) throw new EditError('failed to assign id to inserted node');
    this.refs.set(ref, id);
  }
}

function resolveTable(node: LexicalNode): TableNode {
  let t: LexicalNode | null = node;
  while (t && !$isTableNode(t)) t = t.getParent();
  if (!$isTableNode(t)) throw new EditError('no enclosing table');
  return t;
}

function emptyCell(header: boolean) {
  const cell = $createTableCellNode(header ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS);
  cell.append($createParagraphNode());
  return cell;
}

/** Insert plain `text` at char offset `at` within a block. Plain text inserted at
 *  the edge of a FORMATTED run goes into a fresh unformatted node (so appending
 *  after a bold word, or prepending before one, stays plain) rather than
 *  inheriting that run's format. Past the end appends; empty block creates a new node. */
function insertTextAt(block: ElementNode, at: Offset, text: string): void {
  const texts = collectTextNodes(block);
  if (texts.length === 0) {
    block.append($createTextNode(text));
    return;
  }
  const total = texts.reduce((n, t) => n + t.getTextContent().length, 0);
  // prepend boundary
  if (at <= 0) {
    const first = texts[0]!;
    if (first.getFormat() !== 0) first.insertBefore($createTextNode(text));
    else first.setTextContent(text + first.getTextContent());
    return;
  }
  // append boundary
  if (at >= total) {
    const last = texts[texts.length - 1]!;
    if (last.getFormat() !== 0) last.insertAfter($createTextNode(text));
    else last.setTextContent(last.getTextContent() + text);
    return;
  }
  // interior: splice into the run that contains the offset
  let remaining = at;
  for (const tn of texts) {
    const content = tn.getTextContent();
    if (remaining <= content.length) {
      tn.setTextContent(content.slice(0, remaining) + text + content.slice(remaining));
      return;
    }
    remaining -= content.length;
  }
}

/** Remove `len` chars starting at offset `at`, spanning text nodes as needed. */
function removeTextAt(block: ElementNode, at: Offset, len: number): void {
  let skip = at;
  let left = len;
  for (const tn of collectTextNodes(block)) {
    if (left <= 0) break;
    const content = tn.getTextContent();
    if (skip >= content.length) {
      skip -= content.length;
      continue;
    }
    const start = skip;
    const end = Math.min(content.length, start + left);
    tn.setTextContent(content.slice(0, start) + content.slice(end));
    left -= end - start;
    skip = 0;
  }
}

/** Insert an inline node at char offset `at` within a block. */
function insertInlineAt(block: ElementNode, at: Offset, inline: LexicalNode): void {
  let remaining = at;
  for (const tn of collectTextNodes(block)) {
    const len = tn.getTextContent().length;
    if (remaining <= len) {
      if (remaining === 0) tn.insertBefore(inline);
      else if (remaining >= len) tn.insertAfter(inline);
      else {
        const [, tail] = tn.splitText(remaining);
        (tail ?? tn).insertBefore(inline);
      }
      return;
    }
    remaining -= len;
  }
  block.append(inline);
}

/** Turn a declarative spec into real Lexical nodes. */
export function buildNode(spec: NodeSpec): LexicalNode {
  return match(spec)
    .returnType<LexicalNode>()
    .with({ block: 'paragraph' }, (s) => withText($createParagraphNode(), s.text))
    .with({ block: 'heading' }, (s) => withText($createHeadingNode(`h${s.level}` as HeadingTagType), s.text))
    .with({ block: 'quote' }, (s) => withText($createQuoteNode(), s.text))
    .with({ block: 'code' }, (s) => withText($createCodeNode(s.language), s.text))
    .with({ block: 'list' }, (s) => {
      const list = $createListNode(s.list as ListType);
      for (const item of s.items) {
        const li = $createListItemNode(s.list === 'check' ? false : undefined);
        li.append($createTextNode(item));
        list.append(li);
      }
      return list;
    })
    .with({ block: 'table' }, (s) => $table(s.rows))
    .with({ block: 'divider' }, () => $createHorizontalRuleNode())
    .with({ block: 'image' }, (s) => $createImageNode({ srcType: s.srcType, url: s.url, alt: s.alt, width: s.width, height: s.height }))
    .with({ block: 'video' }, (s) => $createVideoNode({ srcType: s.srcType, url: s.url, controls: s.controls, width: s.width, height: s.height }))
    .with({ block: 'equation' }, (s) => $createEquationNode(s.tex, s.inline ?? false))
    .with({ inline: 'linebreak' }, () => $createLineBreakNode())
    .with({ inline: 'equation' }, (s) => $createEquationNode(s.tex, true))
    .with({ inline: 'date' }, (s) => $createDateMentionNode({ date: s.date, displayFormat: s.displayFormat ?? s.date }))
    .with({ inline: 'mention' }, (s) => {
      const m = s.mention;
      if (m.kind === 'user') return $createUserMentionNode({ userId: m.userId, email: m.email });
      if (m.kind === 'contact') return $createContactMentionNode({ contactId: m.contactId, name: m.name, emailOrDomain: m.emailOrDomain, isCompany: m.isCompany });
      if (m.kind === 'group') return $createGroupMentionNode({ groupAlias: m.groupAlias });
      return $createDocumentMentionNode({ documentId: m.documentId, documentName: m.documentName, blockName: m.blockName });
    })
    .exhaustive();
}

function withText(block: ElementNode, text?: string): ElementNode {
  if (text) block.append($createTextNode(text));
  return block;
}
