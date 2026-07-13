import type Term from '../model/Term';
import { useIsPopup } from '../signal/pdfViewer';
import { usePopupContextUpdate, usePopupStore } from '../store/definitionPopup';
import { DefinitionLookup } from './DefinitionLookup/index';

interface IProps {
  terms: Term[];
}

/**
 * Wrapper on `DefinitionLookup` which positions a list of terms absolutely
 * positioned on the screen (overlayed on top of the PDF)
 */
export function AbsoluteDefinitionLookups(props: IProps) {
  const isPopup = useIsPopup();
  const popupDispatchCtx = usePopupContextUpdate(isPopup);
  const element = usePopupStore(isPopup).element;

  return (
    <DefinitionLookup
      isPinsWindow={false}
      term={props.terms[0]}
      index={0}
      addNextTerm={(term) => {
        popupDispatchCtx({ type: 'ADD_NEXT_TERM', term });
      }}
      removeNextTerms={(index) => {
        popupDispatchCtx({ type: 'REMOVE_NEXT_TERMS', index });
      }}
      anchorRef={element()}
    />
  );
}
