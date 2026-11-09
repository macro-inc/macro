import type { PointType } from 'lexical';
import type { NodeSelection } from './node';
import type { Point } from './point';
import type { RangeSelection } from './range';
import type { SelectionRuntime } from './runtime';

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
/** Compared only by the whole-graph declaration oracle after strict emit. */
export type SelectionObservableExpected = {
  public: Pick<typeof import('lexical'), SelectionExports>;
  range: import('lexical').RangeSelection;
  point: import('lexical').Point;
  node: import('lexical').NodeSelection;
  tableFactory: Pick<
    typeof import('@lexical/table'),
    '$createTableSelection' | '$isTableSelection'
  >;
};
export type SelectionObservableActual = {
  public: Pick<typeof import('./index'), SelectionExports>;
  range: RangeSelection;
  point: Point;
  node: NodeSelection;
  tableFactory: {
    $createTableSelection: SelectionRuntime['createTableSelection'];
    $isTableSelection: SelectionRuntime['isTableSelection'];
  };
};
/** Named exception: upstream excludes the actual owner-less construction state. */
export type UpstreamPointOwnerGap = Matches<
  false,
  null extends PointType['_selection'] ? true : false
>;
export type InternalPointOwnerContract = Matches<
  true,
  null extends Point['_selection'] ? true : false
>;
