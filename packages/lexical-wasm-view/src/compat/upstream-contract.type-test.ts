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

/** Checked by tsc only; this module is never evaluated by the application. */
export type DOMPublicContract = Matches<
  Pick<typeof import('lexical'), DOMExports>,
  Pick<typeof import('./index'), DOMExports>
>;

export type DOMSlotContract = Matches<
  UpstreamDOMSlot<HTMLDivElement>,
  DOMSlot<HTMLDivElement>
>;
export type DOMSlotInputContract = Matches<
  DOMSlot<HTMLDivElement>,
  UpstreamDOMSlot<HTMLDivElement>
>;
export type ElementDOMSlotContract = Matches<
  UpstreamElementDOMSlot<HTMLTableElement>,
  ElementDOMSlot<HTMLTableElement>
>;
export type ElementDOMSlotInputContract = Matches<
  ElementDOMSlot<HTMLTableElement>,
  UpstreamElementDOMSlot<HTMLTableElement>
>;

type InternalRuntimeExports =
  | 'RangeSelection'
  | '$getCompositionKey'
  | 'createEmptyEditorState'
  | 'getActiveEditor'
  | 'getActiveEditorState'
  | 'isCurrentlyReadOnlyMode'
  | 'updateEditorSync'
  | 'withReconciliation';
type PublicRuntime = Omit<CompatRuntime, InternalRuntimeExports>;

export type DOMRuntimeContract = Matches<
  Pick<typeof import('lexical'), keyof PublicRuntime>,
  PublicRuntime
>;
