import { createBlockSignal } from '@core/block';
import type { NamedTool } from '@service-cognition/generated/tools/tool';

export type MarkdownRewriteOutput = NamedTool<
  'MarkdownRewrite',
  'response'
>['data'];

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
