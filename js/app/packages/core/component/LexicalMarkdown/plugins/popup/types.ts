import type { TableSelection } from '@lexical/table';
import type { RangeSelection } from 'lexical';

export type EnhancedTableSelection = {
  type: 'table';
  rect: DOMRect;
  text: string;
  nodeText: string;
  lexicalSelection: TableSelection;
};

export type EnhancedRangeSelection = {
  type: 'range';
  rect: DOMRect;
  text: string;
  nodeText: string;
  lexicalSelection: RangeSelection;
  domSelection: Selection;
};

export type EnhancedSelection = EnhancedRangeSelection | EnhancedTableSelection;
