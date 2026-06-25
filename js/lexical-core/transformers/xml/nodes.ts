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
  | LinkNode;

export type UnknownNode = Id & {
  type: Exclude<string, KnownNode['type']>;
  version?: number;
  children?: SerNode[];
};

export type SerNode = KnownNode | UnknownNode;
