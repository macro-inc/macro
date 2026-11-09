import type { PointType } from 'lexical';
import type { NodeSelection } from './node';
import type { Point } from './point';
import type { RangeSelection } from './range';

type Matches<Expected, Actual extends Expected> = Actual;
type SelectionExports =
  | '$createPoint'
  | '$createRangeSelection'
  | '$createNodeSelection'
  | '$getSelection'
  | '$getPreviousSelection'
  | '$setSelection'
  | '$isRangeSelection'
  | '$isNodeSelection'
  | '$getCharacterOffsets'
  | '$isBlockElementNode'
  | '$insertNodes'
  | '$generateNodesFromRawText'
  | '$getTextContent'
  | '$normalizeSelection__EXPERIMENTAL'
  | 'tokenizeRawText';
export type SelectionPublicContract = Matches<
  Pick<typeof import('lexical'), SelectionExports>,
  Pick<typeof import('./index'), SelectionExports>
>;
export type RangeSelectionContract = Matches<
  import('lexical').RangeSelection,
  RangeSelection
>;
export type PointContract = Matches<import('lexical').Point, Point>;
export type NodeSelectionContract = Matches<
  import('lexical').NodeSelection,
  NodeSelection
>;
/** Named exception: upstream excludes the actual owner-less construction state. */
export type UpstreamPointOwnerGap = Matches<
  false,
  null extends PointType['_selection'] ? true : false
>;
export type InternalPointOwnerContract = Matches<
  true,
  null extends Point['_selection'] ? true : false
>;
