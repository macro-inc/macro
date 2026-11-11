import type { LexicalNode } from '../../nodes';
import { $isRootNode } from '../../nodes/predicates';
import { $findMatchingParent } from '../tree';

declare const node: LexicalNode;
export const rootResult: ReturnType<LexicalNode['getParent']> | null =
  $findMatchingParent(node, $isRootNode);
export const baseResult: LexicalNode | null = $findMatchingParent(
  node,
  () => true
);
