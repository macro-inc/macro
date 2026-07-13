export type Id = { $?: { id: string } };

type EleBase = Id & {
  version: number;
  direction: string | null;
  format: string;
  indent: number;
};

export type TextNode = Id & {
  type: 'text';
  text: string;
  format: number;
  detail: number;
  mode: string;
  style: string;
  version: number;
};

export type LineBreakNode = Id & {
  type: 'linebreak';
  version: number;
};

export type ParagraphNode = EleBase & {
  type: 'paragraph';
  children: SerNode[];
  textFormat: number;
  textStyle: string;
};

export type HeadingNode = EleBase & {
  type: 'heading';
  children: SerNode[];
  tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
};

export type QuoteNode = EleBase & {
  type: 'quote';
  children: SerNode[];
};

export type ListNode = EleBase & {
  type: 'list';
  children: SerNode[];
  listType: 'bullet' | 'number' | 'check';
  start: number;
  tag: 'ul' | 'ol';
};

export type ListItemNode = EleBase & {
  type: 'listitem';
  children: SerNode[];
  value: number;
  checked?: boolean;
};

export type TableNode = EleBase & {
  type: 'table';
  children: SerNode[];
  colWidths?: number[];
  rowStriping?: boolean;
};

export type TableRowNode = EleBase & {
  type: 'tablerow';
  children: SerNode[];
  height?: number;
};

export type TableCellNode = EleBase & {
  type: 'tablecell';
  children: SerNode[];
  headerState: number;
  colSpan: number;
  rowSpan: number;
  backgroundColor: string | null;
};

export type HrNode = Id & {
  type: 'horizontalrule';
  version: number;
};

export type DateMentionNode = Id & {
  type: 'date-mention';
  version: number;
  date: string;
  displayFormat: string;
  mentionUuid?: string;
};

export type LinkNode = EleBase & {
  type: 'link' | 'autolink';
  children: SerNode[];
  url: string;
  rel?: string | null;
  target?: string | null;
  title?: string | null;
};

export type MarkNode = EleBase & {
  type: 'mark';
  children: SerNode[];
  ids: string[];
};

export type TabNode = Id & {
  type: 'tab';
  version: number;
};

export type ClassedBlockNode = EleBase & {
  type: 'classed-block';
  children: SerNode[];
  tag: string;
  classes: string[];
  attributes?: Record<string, string>;
};

/** A code block whose children are per-token `code-highlight` leaves (flattened
 *  back into raw source on serialize). `language` comes from the `CodeNode` base. */
export type CustomCodeNode = EleBase & {
  type: 'custom-code';
  children: SerNode[];
  language: string | null;
};

export type EquationNode = Id & {
  type: 'equation';
  version: number;
  equation: string;
  inline: boolean;
};

export type ImageNode = Id & {
  type: 'image';
  version: number;
  alt: string;
  url: string;
};

export type VideoNode = Id & {
  type: 'video';
  version: number;
  url: string;
  controls: boolean;
};

export type HtmlRenderNode = Id & {
  type: 'html-render';
  version: number;
  html: string;
};

export type DocumentCardNode = Id & {
  type: 'document-card';
  version: number;
  documentId: string;
  documentName: string;
};

export type UserMentionNode = Id & {
  type: 'user-mention';
  version: number;
  userId: string;
  email: string;
};

export type DocumentMentionNode = Id & {
  type: 'document-mention';
  version: number;
  documentId: string;
  documentName: string;
};

export type ContactMentionNode = Id & {
  type: 'contact-mention';
  version: number;
  contactId: string;
  name: string;
  emailOrDomain: string;
  isCompany: boolean;
};

export type GroupMentionNode = Id & {
  type: 'group-mention';
  version: number;
  groupAlias: string;
};

export type PullRequestMentionNode = Id & {
  type: 'pr-mention';
  version: number;
  id: string;
  label: string;
};

export type ThemeMentionNode = Id & {
  type: 'theme-mention';
  version: number;
  name: string;
};

export type UnknownMentionNode = Id & {
  type: 'unknown-mention';
  version: number;
  name: string;
};

export type KnownNode =
  | TextNode
  | LineBreakNode
  | ParagraphNode
  | HeadingNode
  | QuoteNode
  | ListNode
  | ListItemNode
  | TableNode
  | TableRowNode
  | TableCellNode
  | HrNode
  | DateMentionNode
  | LinkNode
  | MarkNode
  | TabNode
  | ClassedBlockNode
  | CustomCodeNode
  | EquationNode
  | ImageNode
  | VideoNode
  | HtmlRenderNode
  | DocumentCardNode
  | UserMentionNode
  | DocumentMentionNode
  | ContactMentionNode
  | GroupMentionNode
  | PullRequestMentionNode
  | ThemeMentionNode
  | UnknownMentionNode;

export type UnknownNode = Id & {
  type: Exclude<string, KnownNode['type']>;
  version?: number;
  children?: SerNode[];
};

export type SerNode = KnownNode | UnknownNode;
