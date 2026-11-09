/** Test-only producer: all nodes, points, selections and carets belong to one real upstream core. */
import type * as Lexical from 'lexical';
import {
  createSelectionDOMMethods,
  type PointCaret,
  type SelectionDOMRuntime,
} from './selection-methods';
import { getUpstreamRuntime } from './test-setup';

type Direction = 'next' | 'previous';

export function createUpstreamSelectionDOMMethods(model: typeof Lexical) {
  const constructors = new Set<Function>();
  const points = new WeakMap<object, Lexical.PointType>();
  const selections = new WeakMap<object, Lexical.RangeSelection>();
  function isSourceCaret<D extends Direction>(
    caret: PointCaret<D>
  ): caret is PointCaret<D> & Lexical.PointCaret<D> {
    for (const caretClass of constructors) {
      if (caret instanceof caretClass) return true;
    }
    return false;
  }
  function requireCaret<D extends Direction>(
    caret: PointCaret<D>
  ): PointCaret<D> & Lexical.PointCaret<D> {
    if (!isSourceCaret(caret))
      throw new Error('Expected a real upstream caret');
    return caret;
  }
  function remember(selection: Lexical.RangeSelection): void {
    selections.set(selection, selection);
    points.set(selection.anchor, selection.anchor);
    points.set(selection.focus, selection.focus);
  }
  const runtime: SelectionDOMRuntime = {
    ...getUpstreamRuntime(),
    $caretFromPoint(point, direction) {
      const caret = model.$caretFromPoint(point, direction);
      // Private caret constructors come from real factories in the active scope.
      // instanceof then validates carets yielded later by their original iterators.
      constructors.add(caret.constructor);
      constructors.add(
        model.$getSiblingCaret(caret.origin, direction).constructor
      );
      constructors.add(
        model.$getChildCaret(model.$getRoot(), direction).constructor
      );
      return caret;
    },
    $isExtendableTextPointCaret: (
      caret
    ): caret is Extract<typeof caret, { type: 'text' }> & {
      getNodeAtCaret(): import('./types').CompatTextNode;
    } => model.$isExtendableTextPointCaret(requireCaret(caret)),
    $extendCaretToRange(caret) {
      return model.$extendCaretToRange(requireCaret(caret));
    },
    $isChildCaret: (
      caret
    ): caret is Extract<NonNullable<typeof caret>, { type: 'child' }> =>
      caret != null && model.$isChildCaret(requireCaret(caret)),
    $normalizeCaret(caret) {
      return model.$normalizeCaret(requireCaret(caret));
    },
    $setPointFromCaret(point, caret) {
      const original = points.get(point);
      if (original === undefined)
        throw new Error('Expected a captured upstream point');
      model.$setPointFromCaret(original, requireCaret(caret));
    },
    $createNodeSelection: model.$createNodeSelection,
    $getNearestRootOrShadowRoot(node) {
      const original = model.$getNodeByKey(node.__key);
      if (original !== node)
        throw new Error('Expected the current upstream node');
      return model.$getNearestRootOrShadowRoot(original);
    },
    $hasAncestor(child, target) {
      const originalChild = model.$getNodeByKey(child.__key);
      const originalTarget = model.$getNodeByKey(target.__key);
      if (originalChild !== child || originalTarget !== target)
        throw new Error('Expected current upstream nodes');
      return model.$hasAncestor(originalChild, originalTarget);
    },
    $normalizeSelection__EXPERIMENTAL(selection) {
      const original = selections.get(selection);
      if (original === undefined)
        throw new Error('Expected a captured upstream range');
      model.$normalizeSelection__EXPERIMENTAL(original);
      return selection;
    },
  };
  const methods = createSelectionDOMMethods(runtime);
  return {
    applyDOMRange(selection: Lexical.RangeSelection, range: StaticRange) {
      remember(selection);
      methods.applyDOMRange(selection, range);
    },
    modifyDOMSelection(
      selection: Lexical.RangeSelection,
      alter: 'move' | 'extend',
      backward: boolean,
      granularity: 'character' | 'word' | 'lineboundary'
    ) {
      remember(selection);
      methods.modifyDOMSelection(selection, alter, backward, granularity);
    },
  };
}
