export interface Diff {
  operation: string;
  node_key: string;
  markdown_text: string;
}

export type MarkdownRewriteOutput = {
  diffs: Diff[];
};

export interface NodeWithText {
  key: string;
  markdown: string;
}
