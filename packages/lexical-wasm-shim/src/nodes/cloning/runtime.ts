import type { ElementNode, LexicalNode, TextNode } from '../index';
import type { StateRecord } from '../state/record';

export type BaseCloneField = '__parent' | '__next' | '__prev';
export type ElementCloneField =
  | '__first'
  | '__last'
  | '__size'
  | '__indent'
  | '__format'
  | '__style'
  | '__dir'
  | '__textFormat'
  | '__textStyle';
export type TextCloneField =
  | '__text'
  | '__format'
  | '__style'
  | '__mode'
  | '__detail';

/** State reads guard the real stage before COW/reset; writes validate its pair. */
export interface CloneRuntime {
  readonly getRawState: (node: LexicalNode) => StateRecord | undefined;
  readonly setRawState: (
    node: LexicalNode,
    state: StateRecord | undefined
  ) => void;
  readonly writeBaseField: <K extends BaseCloneField>(
    target: LexicalNode,
    previous: LexicalNode,
    field: K,
    value: LexicalNode[K]
  ) => void;
  readonly writeElementField: <K extends ElementCloneField>(
    target: ElementNode,
    previous: ElementNode,
    field: K,
    value: ElementNode[K]
  ) => void;
  readonly writeTextField: <K extends TextCloneField>(
    target: TextNode,
    previous: TextNode,
    field: K,
    value: TextNode[K]
  ) => void;
}

let runtime: CloneRuntime | undefined;

export function bindCloneRuntime(value: CloneRuntime): void {
  runtime = value;
}

export function getCloneRuntime(): CloneRuntime {
  if (runtime === undefined)
    throw new Error('Actual native clone-stage runtime has not been bound');
  return runtime;
}
