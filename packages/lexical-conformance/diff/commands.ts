import type { TextFormatType } from 'lexical';
export type Position = {
  path: number[];
  offset: number;
  type: 'text' | 'element';
};
export type Command =
  | { kind: 'Select' | 'SelectionFromView'; anchor: Position; focus: Position }
  | { kind: 'InsertText' | 'InsertRawText'; text: string }
  | { kind: 'InsertParagraph' | 'InsertLineBreak' | 'InsertTab' | 'RemoveText' }
  | { kind: 'FormatText'; format: TextFormatType }
  | {
      kind: 'TextFromView';
      path: number[];
      text: string;
      anchor: number;
      focus: number;
      compositionEnd: boolean;
    };
export type CommitRecord = {
  dirtyLeaves: string[];
  dirtyElements: [string, boolean][];
  mutations: [string, string][];
  normalized: string[];
  tags: string[];
};
export type Snapshot = {
  state: unknown;
  selection: unknown;
  text: string;
  keys: { path: number[]; key: string }[];
  commit: CommitRecord | null;
  error: string | null;
};
