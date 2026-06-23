/**
 * The op vocabulary. `DocumentEditor`'s many ergonomic methods all collapse onto
 * this small set of semantic `DocumentOp`s. Each op kind has exactly one animator
 * (queue/animators) and one writer path (doc/doc.ts). These are plain data —
 * nothing here imports Lexical.
 */

/** A durable node id (the `{id}` / `<t id>` the model sees). */
export type NodeId = string;

/** Placeholder for a node that doesn't exist yet; minted by a creator method and
 *  resolved to a real id by `Doc` when its `insertBlock`/`insertInline` runs. */
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
export type Scope = { nth?: number; all?: boolean };

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
  | { block: 'image'; srcType: string; url: string; alt?: string; width?: number; height?: number }
  | { block: 'video'; srcType: string; url: string; controls?: boolean; width?: number; height?: number }
  | { block: 'equation'; tex: string; inline?: boolean }
  | { inline: 'linebreak' }
  | { inline: 'equation'; tex: string }
  | { inline: 'date'; date: string; displayFormat?: string }
  | { inline: 'mention'; mention: MentionSpec };

export type ListKind = 'bullet' | 'number' | 'check';

/** Entity-mention specs. The supervisor resolves names to ids via `searchContacts`. */
export type MentionSpec =
  | { kind: 'user'; userId: string; email: string }
  | { kind: 'contact'; contactId: string; name: string; emailOrDomain: string; isCompany: boolean }
  | { kind: 'group'; groupAlias: string }
  | { kind: 'document'; documentId: string; documentName: string; blockName: string };

/** Block-type targets for `setBlockType`. */
export type BlockType = 'paragraph' | 'heading' | 'quote' | 'code';

/** The canonical op set. Many `DocumentEditor` methods map onto each kind. */
export type DocumentOp =
  | { kind: 'formatText'; id: NodeId; match: string; format: Format; on: boolean; scope: Scope }
  | { kind: 'clearFormat'; id: NodeId; match?: string; scope: Scope } // match omitted = whole block
  | { kind: 'formatNode'; textId: NodeId; format: Format; on: boolean }
  | { kind: 'clearNodeFormat'; textId: NodeId }
  | { kind: 'markText'; id: NodeId; match: string; on: boolean; scope: Scope }
  | { kind: 'linkText'; id: NodeId; match: string; url: string | null; scope: Scope }
  | { kind: 'setText'; id: NodeId; text: string }
  | { kind: 'setEquation'; id: NodeId; tex: string }
  | { kind: 'replaceText'; id: NodeId; find: string; to: string; scope: Scope }
  | { kind: 'appendText'; id: NodeId; text: string }
  | { kind: 'prependText'; id: NodeId; text: string }
  | { kind: 'setBlockType'; id: NodeId; block: BlockType; level?: number; language?: string }
  | { kind: 'setListType'; ids: NodeId[]; list: ListKind }
  | { kind: 'setChecked'; id: NodeId; checked: boolean }
  | { kind: 'setIndent'; id: NodeId; indent: number | 'in' | 'out' }
  | { kind: 'sortList'; id: NodeId; order: 'asc' | 'desc' }
  | { kind: 'insertBlock'; ref: Ref; spec: NodeSpec; at: Position }
  | { kind: 'insertInline'; ref: Ref; id: NodeId; at: number; spec: NodeSpec }
  | { kind: 'moveBlock'; id: NodeId; at: Position }
  | { kind: 'removeBlock'; id: NodeId }
  | { kind: 'mergeBlocks'; ids: NodeId[]; separator: string }
  | { kind: 'splitBlock'; id: NodeId; atText: string }
  | { kind: 'setCell'; table: NodeId; row: number; col: number; content: string }
  | { kind: 'addRow'; table: NodeId; at?: number }
  | { kind: 'addColumn'; table: NodeId; at?: number }
  | { kind: 'removeRow'; table: NodeId; row: number }
  | { kind: 'removeColumn'; table: NodeId; col: number }
  | { kind: 'setImageAlt'; id: NodeId; alt: string }
  | { kind: 'setImageUrl'; id: NodeId; url: string }
  | { kind: 'setVideoUrl'; id: NodeId; url: string }
  | { kind: 'setVideoControls'; id: NodeId; controls: boolean }
  | { kind: 'setDate'; id: NodeId; date: string; displayFormat?: string };

export type DocumentOpKind = DocumentOp['kind'];
