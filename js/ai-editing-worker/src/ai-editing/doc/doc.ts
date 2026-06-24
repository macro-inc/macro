/**
 * The one place this system touches real Lexical (and, via `propagate`, Loro).
 * `Doc` implements both `DocReader` (reads to plan) and `DocWriter` (atomic
 * edits), resolving every `NodeRef` through the durable id ↔ node-key map and
 * delegating the actual mutations to the existing `ai-toolkit` `$`-helpers. A
 * shared `refToId` map turns an inserted node'session placeholder ref into its minted id,
 * so later reads/edits in the same run resolve it.
 */

import { $createCodeNode } from '@lexical/code';
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListType,
} from '@lexical/list';
import {
  $createHeadingNode,
  $createQuoteNode,
  type HeadingTagType,
} from '@lexical/rich-text';
import {
  $createTableCellNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  type TableNode,
} from '@lexical/table';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  type ElementNode,
  type LexicalNode,
} from 'lexical';
import { match } from 'ts-pattern';
import { $createContactMentionNode } from '../../../../lexical-core/nodes/ContactMentionNode';
import {
  $createDateMentionNode,
  $isDateMentionNode,
} from '../../../../lexical-core/nodes/DateMentionNode';
import { $createDocumentCardNode } from '../../../../lexical-core/nodes/DocumentCardNode';
import { $createDocumentMentionNode } from '../../../../lexical-core/nodes/DocumentMentionNode';
import { $createEquationNode } from '../../../../lexical-core/nodes/EquationNode';
import { $createGroupMentionNode } from '../../../../lexical-core/nodes/GroupMentionNode';
import { $createHorizontalRuleNode } from '../../../../lexical-core/nodes/HorizontalRuleNode';
import { $createHtmlRenderNode } from '../../../../lexical-core/nodes/HtmlRenderNode';
import {
  $createImageNode,
  ImageNode,
} from '../../../../lexical-core/nodes/ImageNode';
import { $createUserMentionNode } from '../../../../lexical-core/nodes/UserMentionNode';
import {
  $createVideoNode,
  VideoNode,
} from '../../../../lexical-core/nodes/VideoNode';
import {
  $getId,
  $updateAllNodeIds,
} from '../../../../lexical-core/plugins/nodeIdPlugin';
import * as blocks from '../ai-toolkit/blocks';
import * as inline from '../ai-toolkit/inline';
import * as lists from '../ai-toolkit/lists';
import * as locate from '../ai-toolkit/locate';
import * as modify from '../ai-toolkit/modify';
import type { Session } from '../ai-toolkit/session';
import * as tables from '../ai-toolkit/tables';
import * as tree from '../ai-toolkit/tree';
import { EditError } from '../editor/errors';
import type {
  Edit,
  Format,
  ListKind,
  NodeRef,
  NodeSpec,
  Offset,
  Position,
  Scope,
} from '../editor/ops';
import type { DocReader, DocWriter, Match } from './interfaces';

const FORMAT_BIT: Record<
  Format,
  'bold' | 'italic' | 'underline' | 'strikethrough' | 'code'
> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strikethrough',
  code: 'code',
};

export class Doc implements DocReader, DocWriter {
  private refToId = new Map<string, string>();

  constructor(
    private readonly session: Session,
    /** Push the new state out (snapshot to mirror to Loro). Noop in unit tests. */
    private readonly propagate: () => void = () => {}
  ) {}

  private id(node: NodeRef): string {
    return this.refToId.get(node) ?? node;
  }

  /** Resolve a placeholder ref to its minted id (identity if not a ref). Used by
   *  the executor to point awareness at the real node once an insert has run. */
  public resolveRef(node: NodeRef): NodeRef {
    return this.id(node);
  }

  public apply(edit: Edit): void {
    match(edit)
      .with({ fn: 'insertText' }, (e) => this.insertText(e.node, e.at, e.text))
      .with({ fn: 'removeText' }, (e) => this.removeText(e.node, e.at, e.len))
      .with({ fn: 'setText' }, (e) => this.setText(e.node, e.text))
      .with({ fn: 'setEquation' }, (e) => this.setEquation(e.node, e.tex))
      .with({ fn: 'appendText' }, (e) => this.appendText(e.node, e.text))
      .with({ fn: 'prependText' }, (e) => this.prependText(e.node, e.text))
      .with({ fn: 'replaceText' }, (e) =>
        this.replaceText(e.node, e.find, e.to, e.scope)
      )
      .with({ fn: 'formatText' }, (e) =>
        this.formatText(e.node, e.match, e.format, e.on, e.scope)
      )
      .with({ fn: 'clearFormat' }, (e) =>
        this.clearFormat(e.node, e.match, e.scope)
      )
      .with({ fn: 'markText' }, (e) =>
        this.markText(e.node, e.match, e.on, e.scope)
      )
      .with({ fn: 'linkText' }, (e) =>
        this.linkText(e.node, e.match, e.url, e.scope)
      )
      .with({ fn: 'formatNode' }, (e) =>
        this.formatNode(e.node, e.format, e.on)
      )
      .with({ fn: 'clearNodeFormat' }, (e) => this.clearNodeFormat(e.node))
      .with({ fn: 'setBlockType' }, (e) =>
        this.setBlockType(e.node, e.block, {
          level: e.level,
          language: e.language,
        })
      )
      .with({ fn: 'setListType' }, (e) => this.setListType(e.nodes, e.list))
      .with({ fn: 'appendListItem' }, (e) =>
        this.appendListItem(e.ref, e.node, e.checked)
      )
      .with({ fn: 'setChecked' }, (e) => this.setChecked(e.node, e.checked))
      .with({ fn: 'setIndent' }, (e) => this.setIndent(e.node, e.indent))
      .with({ fn: 'insertNode' }, (e) => this.insertNode(e.ref, e.spec, e.at))
      .with({ fn: 'insertInline' }, (e) =>
        this.insertInline(e.ref, e.node, e.at, e.spec)
      )
      .with({ fn: 'moveNode' }, (e) => this.moveNode(e.node, e.at))
      .with({ fn: 'removeNode' }, (e) => this.removeNode(e.node))
      .with({ fn: 'mergeBlocks' }, (e) =>
        this.mergeBlocks(e.nodes, e.separator)
      )
      .with({ fn: 'insertListItemAfter' }, (e) =>
        this.insertListItemAfter(e.ref, e.node, e.text, e.list)
      )
      .with({ fn: 'insertListItemBefore' }, (e) =>
        this.insertListItemBefore(e.ref, e.node, e.text, e.list)
      )
      .with({ fn: 'removeListItem' }, (e) => this.removeListItem(e.node))
      .with({ fn: 'setCell' }, (e) =>
        this.setCell(e.table, e.row, e.col, e.text)
      )
      .with({ fn: 'addRow' }, (e) => this.addRow(e.table, e.at))
      .with({ fn: 'addColumn' }, (e) => this.addColumn(e.table, e.at))
      .with({ fn: 'removeRow' }, (e) => this.removeRow(e.table, e.row))
      .with({ fn: 'removeColumn' }, (e) => this.removeColumn(e.table, e.col))
      .with({ fn: 'setImageAlt' }, (e) => this.setImageAlt(e.node, e.alt))
      .with({ fn: 'setImageUrl' }, (e) => this.setImageUrl(e.node, e.url))
      .with({ fn: 'setVideoUrl' }, (e) => this.setVideoUrl(e.node, e.url))
      .with({ fn: 'setVideoControls' }, (e) =>
        this.setVideoControls(e.node, e.controls)
      )
      .with({ fn: 'setDate' }, (e) =>
        this.setDate(e.node, e.date, e.displayFormat)
      )
      .exhaustive();
  }

  private read<T>(fn: () => T): T {
    return this.session.editor.getEditorState().read(fn);
  }

  /** One discrete update; partial work is discarded on throw, errors surface as
   *  EditError, and the edit propagates to the live doc immediately so changes
   *  (and typing) stream in as they happen. */
  private tx(fn: () => void): void {
    const before = this.session.editor.getEditorState();
    try {
      this.session.editor.update(fn, { discrete: true });
    } catch (e) {
      this.session.editor.setEditorState(before);
      this.session.editor.update(() => $updateAllNodeIds(this.session.ids), {
        discrete: true,
      });
      if (!(e instanceof Error)) throw new Error(String(e));
      if (!(e instanceof EditError)) throw new EditError(e.message);
      throw e;
    }
    this.propagate();
  }

  private block(node: NodeRef): ElementNode {
    return locate.$blockById(this.session, this.id(node));
  }

  public textLength(node: NodeRef): number {
    return this.read(
      () => locate.$byId(this.session, this.id(node)).getTextContent().length
    );
  }

  public locate(id: string, match: string, scope?: Scope): Match[] {
    return this.read(() => locate.$locate(this.block(id), match, scope));
  }

  public cellNode(table: string, row: number, col: number): NodeRef {
    return this.read(() => {
      const cell = this.cell(this.id(table), row, col);
      const content = cell.getChildren().find($isElementNode) ?? cell;
      const cid = $getId(content as LexicalNode);
      if (!cid)
        throw new EditError(`cell [${row}, ${col}] has no addressable content`);
      return cid;
    });
  }

  private cell(tableRef: string, row: number, col: number) {
    const table = resolveTable(locate.$byId(this.session, tableRef));
    const cell = table
      .getChildren()
      .filter($isTableRowNode)
      [row]?.getChildren()
      .filter($isTableCellNode)[col];
    if (!cell) throw new EditError(`no cell at [${row}, ${col}]`);
    return cell;
  }

  private insertText(node: NodeRef, at: Offset, text: string): void {
    this.tx(() => insertTextAt(this.block(node), at, text));
  }

  private removeText(node: NodeRef, at: Offset, len: number): void {
    this.tx(() => removeTextAt(this.block(node), at, len));
  }

  private setText(node: NodeRef, text: string): void {
    this.tx(() => blocks.$setText(this.block(node), text));
  }

  private appendText(node: NodeRef, text: string): void {
    this.tx(() => inline.$appendText(this.block(node), text));
  }

  private prependText(node: NodeRef, text: string): void {
    this.tx(() => inline.$prependText(this.block(node), text));
  }

  private replaceText(
    node: NodeRef,
    find: string,
    to: string,
    scope: Scope
  ): void {
    this.tx(() => inline.$replaceString(this.block(node), find, to, scope));
  }

  private formatText(
    node: NodeRef,
    match: string,
    format: Format,
    on: boolean,
    scope: Scope
  ): void {
    this.tx(() => {
      const block = this.block(node);
      if (on) inline.$formatTextInBlock(block, match, format, scope);
      else inline.$clearFormat(block, match, format, scope);
    });
  }

  private clearFormat(
    node: NodeRef,
    match: string | undefined,
    scope: Scope
  ): void {
    this.tx(() => {
      const block = this.block(node);
      if (match === undefined) inline.$stripFormat(block);
      else inline.$clearFormat(block, match, undefined, scope);
    });
  }

  private markText(
    node: NodeRef,
    match: string,
    on: boolean,
    scope: Scope
  ): void {
    this.tx(() => {
      if (on) inline.$highlightInBlock(this.block(node), match, scope);
      else inline.$unhighlightInBlock(this.block(node), match, scope);
    });
  }

  private linkText(
    node: NodeRef,
    match: string,
    url: string | null,
    scope: Scope
  ): void {
    this.tx(() => {
      if (url !== null) inline.$wrapInLink(this.block(node), match, url, scope);
      else inline.$unwrapFromLink(this.block(node), match, scope);
    });
  }

  private formatNode(node: NodeRef, format: Format, on: boolean): void {
    this.tx(() => {
      const tn = locate.$textById(this.session, this.id(node));
      const bit = FORMAT_BIT[format];
      if (tn.hasFormat(bit) !== on) tn.toggleFormat(bit);
    });
  }

  private clearNodeFormat(node: NodeRef): void {
    this.tx(() => locate.$textById(this.session, this.id(node)).setFormat(0));
  }

  private setEquation(node: NodeRef, tex: string): void {
    this.tx(() =>
      modify.$modifyNode(this.session, this.id(node), { op: 'equation', tex })
    );
  }

  // yes it'session a bit of a gross type but it'session for AI and prefers it flat
  private setBlockType(
    node: NodeRef,
    block: 'paragraph' | 'heading' | 'quote' | 'code',
    opts: { level?: number; language?: string }
  ): void {
    const data: blocks.BlockData =
      block === 'heading'
        ? { type: 'heading', level: opts.level ?? 1 }
        : block === 'code'
          ? { type: 'code', language: opts.language }
          : { type: block };
    this.tx(() =>
      modify.$modifyNode(this.session, this.id(node), {
        op: 'blockType',
        block: data,
      })
    );
  }

  private setListType(nodes: NodeRef[], list: ListKind): void {
    this.tx(() => {
      const resolved = nodes.map((n) => locate.$byId(this.session, this.id(n)));
      const first = resolved[0];
      if (first && first.getType() === 'listitem')
        lists.$setListType(first, list, this.session);
      else lists.$toggleList(resolved, list);
    });
  }

  private setChecked(node: NodeRef, checked: boolean): void {
    this.tx(() =>
      modify.$modifyNode(this.session, this.id(node), {
        op: 'checked',
        checked,
      })
    );
  }

  private setIndent(node: NodeRef, indent: number | 'in' | 'out'): void {
    this.tx(() =>
      modify.$modifyNode(this.session, this.id(node), { op: 'indent', indent })
    );
  }

  private appendListItem(ref: string, node: NodeRef, checked?: boolean): void {
    this.tx(() => {
      const list = locate.$byId(this.session, this.id(node));
      if (!$isListNode(list))
        throw new EditError('appendListItem target is not a list');
      const li = $createListItemNode(checked);
      list.append(li);
      this.assignRef(ref, li);
    });
  }

  private insertNode(ref: string, spec: NodeSpec, at: Position): void {
    this.tx(() => {
      // `insertNode` is for block specs; inline specs go through `insertInline`.
      if ('inline' in spec)
        throw new EditError('insertNode requires a block spec');
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

  private insertInline(
    ref: string,
    node: NodeRef,
    at: Offset,
    spec: NodeSpec
  ): void {
    this.tx(() => {
      const block = this.block(node);
      const inline = buildNode(spec);
      insertInlineAt(block, at, inline);
      this.assignRef(ref, inline);
    });
  }

  private moveNode(node: NodeRef, at: Position): void {
    this.tx(() => {
      const block = this.block(node);
      if ('after' in at)
        blocks.$moveBlock(
          block,
          { placement: 'after', id: this.id(at.after) },
          this.session
        );
      else if ('before' in at)
        blocks.$moveBlock(
          block,
          { placement: 'before', id: this.id(at.before) },
          this.session
        );
      else {
        block.remove();
        if ('appendToRoot' in at) blocks.$appendBlock(block);
        else blocks.$prependBlock(block);
      }
    });
  }

  private removeNode(node: NodeRef): void {
    this.tx(() => locate.$byId(this.session, this.id(node)).remove());
  }

  private mergeBlocks(nodes: NodeRef[], separator: string): void {
    this.tx(() =>
      blocks.$mergeBlocks(
        nodes.map((n) => locate.$byId(this.session, this.id(n))),
        separator
      )
    );
  }

  private insertListItemAfter(
    ref: string,
    node: NodeRef,
    text: string,
    list: ListKind
  ): void {
    this.tx(() => this.insertListItem(ref, node, text, list, 'after'));
  }

  private insertListItemBefore(
    ref: string,
    node: NodeRef,
    text: string,
    list: ListKind
  ): void {
    this.tx(() => this.insertListItem(ref, node, text, list, 'before'));
  }

  private removeListItem(node: NodeRef): void {
    this.tx(() => {
      const li = locate.$byId(this.session, this.id(node));
      if (!$isListItemNode(li))
        throw new EditError(`{${this.id(node)}} is not a list item`);
      li.remove();
    });
  }

  /** Insert a new list item adjacent to an existing one. When `list` matches the
   *  surrounding list it lands as a plain sibling; when it differs, the new item
   *  is wrapped in a sublist of that kind (a numbered list inside a bullet list,
   *  etc.) — Lexical nests via a ListItemNode that holds the child ListNode. */
  private insertListItem(
    ref: string,
    node: NodeRef,
    text: string,
    list: ListKind,
    where: 'after' | 'before'
  ): void {
    const target = locate.$byId(this.session, this.id(node));
    if (!$isListItemNode(target))
      throw new EditError(`{${this.id(node)}} is not a list item`);
    const newLi = $createListItemNode(list === 'check' ? false : undefined);
    newLi.append($createTextNode(text));

    const parent = target.getParent();
    const sameKind =
      $isListNode(parent) && parent.getListType() === (list as ListType);
    if (sameKind) {
      if (where === 'after') target.insertAfter(newLi);
      else target.insertBefore(newLi);
    } else {
      const sublist = $createListNode(list as ListType);
      sublist.append(newLi);
      const host = $createListItemNode();
      host.append(sublist);
      if (where === 'after') target.insertAfter(host);
      else target.insertBefore(host);
    }
    this.assignRef(ref, newLi);
  }

  private setCell(
    table: NodeRef,
    row: number,
    col: number,
    text: string
  ): void {
    this.tx(() =>
      tables.$setCell(
        locate.$byId(this.session, this.id(table)),
        row,
        col,
        text
      )
    );
  }

  private addRow(table: NodeRef, at?: number): void {
    this.tx(() => {
      const t = resolveTable(locate.$byId(this.session, this.id(table)));
      const rows = t.getChildren().filter($isTableRowNode);
      const cols = rows[0]?.getChildren().filter($isTableCellNode).length ?? 1;
      const row = $createTableRowNode();
      for (let c = 0; c < cols; c++) row.append(emptyCell(false));
      if (at == null || at >= rows.length) t.append(row);
      else rows[at]!.insertBefore(row);
    });
  }

  private addColumn(table: NodeRef, at?: number): void {
    this.tx(() => {
      const t = resolveTable(locate.$byId(this.session, this.id(table)));
      t.getChildren()
        .filter($isTableRowNode)
        .forEach((row, ri) => {
          const cells = row.getChildren().filter($isTableCellNode);
          const cell = emptyCell(ri === 0);
          if (at == null || at >= cells.length) row.append(cell);
          else cells[at]!.insertBefore(cell);
        });
    });
  }

  private removeRow(table: NodeRef, row: number): void {
    this.tx(() => {
      const t = resolveTable(locate.$byId(this.session, this.id(table)));
      t.getChildren().filter($isTableRowNode)[row]?.remove();
    });
  }

  private removeColumn(table: NodeRef, col: number): void {
    this.tx(() => {
      const t = resolveTable(locate.$byId(this.session, this.id(table)));
      for (const row of t.getChildren().filter($isTableRowNode)) {
        row.getChildren().filter($isTableCellNode)[col]?.remove();
      }
    });
  }

  private setImageAlt(node: NodeRef, alt: string): void {
    this.tx(() => {
      const n = locate.$byId(this.session, this.id(node));
      if (!(n instanceof ImageNode))
        throw new EditError(`{${node}} is not an image`);
      n.setAlt(alt);
    });
  }

  private setImageUrl(node: NodeRef, url: string): void {
    this.tx(() => {
      const n = locate.$byId(this.session, this.id(node));
      if (!(n instanceof ImageNode))
        throw new EditError(`{${node}} is not an image`);
      n.setUrl(url);
    });
  }

  private setVideoUrl(node: NodeRef, url: string): void {
    this.tx(() => {
      const n = locate.$byId(this.session, this.id(node));
      if (!(n instanceof VideoNode))
        throw new EditError(`{${node}} is not a video`);
      n.setUrl(url);
    });
  }

  private setVideoControls(node: NodeRef, controls: boolean): void {
    this.tx(() => {
      const n = locate.$byId(this.session, this.id(node));
      if (!(n instanceof VideoNode))
        throw new EditError(`{${node}} is not a video`);
      n.setControls(controls);
    });
  }

  private setDate(node: NodeRef, date: string, displayFormat?: string): void {
    this.tx(() => {
      const n = locate.$byId(this.session, this.id(node));
      if (!$isDateMentionNode(n))
        throw new EditError(`{${node}} is not a date mention`);
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
    $updateAllNodeIds(this.session.ids);
    const id = $getId(node);
    if (!id) throw new EditError('failed to assign id to inserted node');
    this.refToId.set(ref, id);
  }
}

function resolveTable(node: LexicalNode): TableNode {
  let t: LexicalNode | null = node;
  while (t && !$isTableNode(t)) t = t.getParent();
  if (!$isTableNode(t)) throw new EditError('no enclosing table');
  return t;
}

function emptyCell(header: boolean) {
  const cell = $createTableCellNode(
    header ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS
  );
  cell.append($createParagraphNode());
  return cell;
}

/** Insert plain `text` at char offset `at` within a block. Plain text inserted at
 *  the edge of a FORMATTED run goes into a fresh unformatted node (so appending
 *  after a bold word, or prepending before one, stays plain) rather than
 *  inheriting that run'session format. Past the end appends; empty block creates a new node. */
function insertTextAt(block: ElementNode, at: Offset, text: string): void {
  const texts = tree.collectTextNodes(block);
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
      tn.setTextContent(
        content.slice(0, remaining) + text + content.slice(remaining)
      );
      return;
    }
    remaining -= content.length;
  }
}

/** Remove `len` chars starting at offset `at`, spanning text nodes as needed. */
function removeTextAt(block: ElementNode, at: Offset, len: number): void {
  let skip = at;
  let left = len;
  for (const tn of tree.collectTextNodes(block)) {
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
function insertInlineAt(
  block: ElementNode,
  at: Offset,
  inline: LexicalNode
): void {
  let remaining = at;
  for (const tn of tree.collectTextNodes(block)) {
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
    .with({ block: 'paragraph' }, (session) =>
      withText($createParagraphNode(), session.text)
    )
    .with({ block: 'heading' }, (session) =>
      withText(
        $createHeadingNode(`h${session.level}` as HeadingTagType),
        session.text
      )
    )
    .with({ block: 'quote' }, (session) =>
      withText($createQuoteNode(), session.text)
    )
    .with({ block: 'code' }, (session) =>
      withText($createCodeNode(session.language), session.text)
    )
    .with({ block: 'list' }, (session) => {
      const list = $createListNode(session.list as ListType);
      for (const item of session.items) {
        const li = $createListItemNode(
          session.list === 'check' ? false : undefined
        );
        li.append($createTextNode(item));
        list.append(li);
      }
      return list;
    })
    .with({ block: 'table' }, (session) => tables.$table(session.rows))
    .with({ block: 'divider' }, () => $createHorizontalRuleNode())
    .with({ block: 'document-card' }, (s) =>
      $createDocumentCardNode({
        documentId: s.documentId,
        documentName: s.documentName,
        blockName: s.blockName,
        blockParams: s.blockParams,
      })
    )
    .with({ block: 'html-render' }, (s) =>
      $createHtmlRenderNode({ html: s.html })
    )
    .with({ block: 'image' }, (session) =>
      $createImageNode({
        srcType: session.srcType,
        url: session.url,
        alt: session.alt,
        width: session.width,
        height: session.height,
      })
    )
    .with({ block: 'video' }, (session) =>
      $createVideoNode({
        srcType: session.srcType,
        url: session.url,
        controls: session.controls,
        width: session.width,
        height: session.height,
      })
    )
    .with({ block: 'equation' }, (session) =>
      $createEquationNode(session.tex, session.inline ?? false)
    )
    .with({ inline: 'linebreak' }, () => $createLineBreakNode())
    .with({ inline: 'equation' }, (session) =>
      $createEquationNode(session.tex, true)
    )
    .with({ inline: 'date' }, (session) =>
      $createDateMentionNode({
        date: session.date,
        displayFormat: session.displayFormat ?? session.date,
      })
    )
    .with({ inline: 'mention' }, (session) => {
      const m = session.mention;
      if (m.kind === 'user')
        return $createUserMentionNode({ userId: m.userId, email: m.email });
      if (m.kind === 'contact')
        return $createContactMentionNode({
          contactId: m.contactId,
          name: m.name,
          emailOrDomain: m.emailOrDomain,
          isCompany: m.isCompany,
        });
      if (m.kind === 'group')
        return $createGroupMentionNode({ groupAlias: m.groupAlias });
      return $createDocumentMentionNode({
        documentId: m.documentId,
        documentName: m.documentName,
        blockName: m.blockName,
      });
    })
    .exhaustive();
}

function withText(block: ElementNode, text?: string): ElementNode {
  if (text) block.append($createTextNode(text));
  return block;
}
