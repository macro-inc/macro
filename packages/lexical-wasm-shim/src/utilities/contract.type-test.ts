import type * as Original from 'lexical';
import type * as Actual from './index';

type Assert<Condition extends true> = Condition;
type PublicName =
  | 'addClassNamesToElement'
  | 'removeClassNamesFromElement'
  | 'normalizeClassNames'
  | 'getDOMOwnerDocument'
  | 'getDOMSelection'
  | 'getDOMSelectionFromTarget'
  | 'getDOMTextNode'
  | 'isDOMNode'
  | 'isDOMDocumentNode'
  | 'isDOMTextNode'
  | 'isDocumentFragment'
  | 'isHTMLElement'
  | 'isInlineDomNode'
  | 'isBlockDomNode'
  | 'isHTMLAnchorElement'
  | 'isHTMLTableCellElement'
  | 'isHTMLTableRowElement'
  | 'isDOMUnmanaged'
  | 'setDOMUnmanaged'
  | 'stopLexicalPropagation'
  | 'isModifierMatch'
  | 'isExactShortcutMatch'
  | 'mergeRegister'
  | 'getTextDirection'
  | 'toggleTextFormatType';
export type AcceptsOriginal = Assert<
  Pick<typeof Actual, PublicName> extends Pick<typeof Original, PublicName>
    ? true
    : false
>;
export type AcceptsActual = Assert<
  Pick<typeof Original, PublicName> extends Pick<typeof Actual, PublicName>
    ? true
    : false
>;

// Brand identity is part of the predicate contract, not reconstructed locally.
export type InlineBrandIdentity = Assert<
  typeof Actual.isInlineDomNode extends typeof Original.isInlineDomNode
    ? true
    : false
>;
export type BlockBrandIdentity = Assert<
  typeof Original.isBlockDomNode extends typeof Actual.isBlockDomNode
    ? true
    : false
>;
