import type {
  DOMSlot as UpstreamDOMSlot,
  ElementDOMSlot as UpstreamElementDOMSlot,
} from 'lexical';
import type { DOMSlot, ElementDOMSlot } from './dom-slot';
import type { CompatRuntime } from './runtime';

type Matches<Expected, Actual extends Expected> = Actual;
type DOMExports =
  | '$createRangeSelectionFromDom'
  | '$updateDOMSelection'
  | 'stopLexicalPropagation';

type InternalRuntimeExports =
  | 'createRangeSelection'
  | '$getCompositionKey'
  | 'createEmptyEditorState'
  | 'getActiveEditor'
  | 'getActiveEditorState'
  | 'isCurrentlyReadOnlyMode'
  | 'updateEditorSync'
  | 'withReconciliation'
  | 'getEditorDOMRenderConfig'
  | 'isSameNode'
  | 'replaceNode'
  | 'decorateNode'
  | 'reconcileObservedMutation'
  | 'publishMutationListeners';
type PublicRuntime = Omit<CompatRuntime, InternalRuntimeExports>;
type ExpectedSelectionMethods = {
  applyDOMRange(
    selection: import('lexical').RangeSelection,
    ...args: Parameters<import('lexical').RangeSelection['applyDOMRange']>
  ): ReturnType<import('lexical').RangeSelection['applyDOMRange']>;
  modifyDOMSelection(
    selection: import('lexical').RangeSelection,
    ...args: Parameters<import('lexical').RangeSelection['modify']>
  ): ReturnType<import('lexical').RangeSelection['modify']>;
};

/**
 * The declaration oracle compares these exact bundles after its test-only
 * private-member projection. Product source never imports that tooling.
 * These pairs alone assert no substitution or complete facade implementation.
 */
export type DOMObservableExpected = {
  public: Pick<typeof import('lexical'), DOMExports>;
  elementDOMSlot: UpstreamElementDOMSlot<HTMLTableElement>;
  input: ElementDOMSlot<HTMLTableElement>;
  runtime: Pick<typeof import('lexical'), keyof PublicRuntime>;
  selectionMethods: ExpectedSelectionMethods;
};
export type DOMObservableActual = {
  public: Pick<typeof import('./index'), DOMExports>;
  elementDOMSlot: ElementDOMSlot<HTMLTableElement>;
  input: UpstreamElementDOMSlot<HTMLTableElement>;
  runtime: PublicRuntime;
  selectionMethods: ReturnType<
    typeof import('./selection-methods').createSelectionDOMMethods
  >;
};

export type DOMSlotContract = Matches<
  UpstreamDOMSlot<HTMLDivElement>,
  DOMSlot<HTMLDivElement>
>;
export type DOMSlotInputContract = Matches<
  DOMSlot<HTMLDivElement>,
  UpstreamDOMSlot<HTMLDivElement>
>;
