import { createBlockSignal } from '@core/block';

export interface Diff {
  operation: string;
  node_key: string;
  markdown_text: string;
}

export type MarkdownRewriteOutput = {
  diffs: Diff[];
};

export const rewriteSignal = createBlockSignal<boolean>(false);
export const isRewritingSignal = createBlockSignal<boolean>(false);

export interface NodeWithText {
  key: string;
  markdown: string;
}

export const nodesAndTextSignal = createBlockSignal<NodeWithText[] | undefined>(
  undefined
);

export const revisionsSignal = createBlockSignal<Diff[] | undefined>(undefined);
