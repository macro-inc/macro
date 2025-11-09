import { createBlockSignal } from '@core/block';
import type { MarkdownRewriteOutput } from '@service-cognition/generated/tools/types';

export const rewriteSignal = createBlockSignal<boolean>(false);
export const isRewritingSignal = createBlockSignal<boolean>(false);

export interface NodeWithText {
  key: string;
  markdown: string;
}

export const nodesAndTextSignal = createBlockSignal<NodeWithText[] | undefined>(
  undefined
);

export const revisionsSignal = createBlockSignal<
  MarkdownRewriteOutput['diffs'] | undefined
>(undefined);
