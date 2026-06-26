/**
 * The unified op vocabulary. `DocumentEditor`'s ergonomic methods collapse onto
 * this set; animators also emit these when simulating keystrokes. Each op kind
 * has exactly one animator (queue/animators) and one writer path (doc/doc.ts).
 * These are plain data — nothing here imports Lexical.
 */

/** A durable node id (the `{id}` / `<t id>` the model sees). */
export type NodeId = string;

/** Placeholder for a node that doesn't exist yet; minted by a creator method and
 *  resolved to a real id by `Doc` when its `insertNode`/`insertInline` runs. */
export type Ref = string;

/** Either an existing node's id or a ref to a not-yet-created one. */
export type NodeRef = NodeId | Ref;

/** A character offset from the start of a node's text content. */
export type Offset = number;

/** A range within a node's text; an omitted bound means the node's edge. */
export type Span = { start?: Offset; end?: Offset };

/** Inline format toggles. */
export type Format = 'bold' | 'italic' | 'underline' | 'strike' | 'code';

/** Which occurrences of a substring match to act on (mirrors ai-toolkit's Scope). */
export type Scope = { kind: 'nth'; n: number } | { kind: 'all' };

/** Where to place a new or moved block. */
export type Position =
  | { after: NodeRef }
  | { before: NodeRef }
  | { appendToRoot: true }
  | { prependToRoot: true };

/** Declarative description of a node to build. `buildNode(spec)` (doc/doc.ts)
 *  turns it into real Lexical nodes; the queue uses `text` to plan typing. */
export type NodeSpec =
  | { block: 'paragraph'; text?: string }
  | { block: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text?: string }
  | { block: 'quote'; text?: string }
  | { block: 'code'; language: string; text?: string }
  | { block: 'list'; list: ListKind; items: string[] }
  | { block: 'table'; rows: string[][] } // row 0 is the header
  | { block: 'divider' }
  | {
      block: 'document-card';
      documentId: string;
      documentName: string;
      blockName: string;
      blockParams?: Record<string, string>;
    }
  | { block: 'html-render'; html: string }
  | {
      block: 'image';
      srcType: string;
      url: string;
      alt?: string;
      width?: number;
      height?: number;
    }
  | {
      block: 'video';
      srcType: string;
      url: string;
      controls?: boolean;
      width?: number;
      height?: number;
    }
  | { block: 'equation'; tex: string; inline?: boolean }
  | { inline: 'linebreak' }
  | { inline: 'equation'; tex: string }
  | { inline: 'date'; date: string; displayFormat?: string }
  | { inline: 'mention'; mention: MentionSpec };

export type ListKind = 'bullet' | 'number' | 'check';

/** Entity-mention specs. Ids are supplied with the edit request, not looked up. */
export type MentionSpec =
  | { kind: 'user'; userId: string; email: string }
  | {
      kind: 'contact';
      contactId: string;
      name: string;
      emailOrDomain: string;
      isCompany: boolean;
    }
  | { kind: 'group'; groupAlias: string }
  | {
      kind: 'document';
      documentId: string;
      documentName: string;
      blockName: string;
    };

/** Block-type targets for `setBlockType`. */
export type BlockType = 'paragraph' | 'heading' | 'quote' | 'code';

/**
 * The canonical op set. `DocumentEditor` methods produce the high-level ops;
 * animators also emit `insertText`, `removeText`, and `appendListItem` to
 * simulate keystrokes. `DocWriter.apply` handles every variant.
 */
export type DocumentOp =
  // animation primitives (emitted by animators, not DocumentEditor)
  | { kind: 'insertText'; node: NodeRef; at: Offset; text: string }
  | { kind: 'removeText'; node: NodeRef; at: Offset; len: number }
  | {
      kind: 'appendListItem';
      ref: string;
      node: NodeRef;
      text: string;
      checked?: boolean;
    }
  | {
      kind: 'prependListItem';
      ref: string;
      node: NodeRef;
      text: string;
      checked?: boolean;
    }
  // text content
  | { kind: 'setText'; node: NodeRef; text: string }
  | { kind: 'setEquation'; node: NodeRef; tex: string }
  | { kind: 'appendText'; node: NodeRef; text: string }
  | { kind: 'prependText'; node: NodeRef; text: string }
  | { kind: 'insertTextAfterInline'; inline: NodeRef; text: string }
  | {
      kind: 'replaceText';
      node: NodeRef;
      find: string;
      to: string;
      scope: Scope;
    }
  // inline formatting
  | {
      kind: 'formatText';
      node: NodeRef;
      match: string;
      format: Format;
      on: boolean;
      scope: Scope;
    }
  | { kind: 'clearFormat'; node: NodeRef; match?: string; scope: Scope }
  | {
      kind: 'markText';
      node: NodeRef;
      match: string;
      on: boolean;
      scope: Scope;
    }
  | {
      kind: 'linkText';
      node: NodeRef;
      match: string;
      url: string | null;
      scope: Scope;
    }
  | { kind: 'formatNode'; node: NodeRef; format: Format; on: boolean }
  | { kind: 'clearNodeFormat'; node: NodeRef }
  // block type / list
  | {
      kind: 'setBlockType';
      node: NodeRef;
      block: BlockType;
      level?: number;
      language?: string;
    }
  | { kind: 'setListType'; nodes: NodeRef[]; list: ListKind }
  | { kind: 'setChecked'; node: NodeRef; checked: boolean }
  | { kind: 'setIndent'; node: NodeRef; indent: number | 'in' | 'out' }
  // structure
  | { kind: 'insertNode'; ref: Ref; spec: NodeSpec; at: Position }
  | {
      kind: 'insertInline';
      ref: Ref;
      node: NodeRef;
      at: Offset;
      spec: NodeSpec;
    }
  | { kind: 'moveNode'; node: NodeRef; at: Position }
  | { kind: 'removeNode'; node: NodeRef }
  | { kind: 'mergeBlocks'; nodes: NodeRef[]; separator: string }
  // list items
  | {
      kind: 'insertListItemAfter';
      ref: Ref;
      node: NodeRef;
      text: string;
      list: ListKind;
    }
  | {
      kind: 'insertListItemBefore';
      ref: Ref;
      node: NodeRef;
      text: string;
      list: ListKind;
    }
  | { kind: 'removeListItem'; node: NodeRef }
  // tables
  | { kind: 'setCell'; table: NodeRef; row: number; col: number; text: string }
  | { kind: 'addRow'; table: NodeRef; at?: number }
  | { kind: 'addColumn'; table: NodeRef; at?: number }
  | { kind: 'removeRow'; table: NodeRef; row: number }
  | { kind: 'removeColumn'; table: NodeRef; col: number }
  // media / date
  | { kind: 'setImageAlt'; node: NodeRef; alt: string }
  | { kind: 'setImageUrl'; node: NodeRef; url: string }
  | { kind: 'setVideoUrl'; node: NodeRef; url: string }
  | { kind: 'setVideoControls'; node: NodeRef; controls: boolean }
  | { kind: 'setDate'; node: NodeRef; date: string; displayFormat?: string };

export type DocumentOpKind = DocumentOp['kind'];
