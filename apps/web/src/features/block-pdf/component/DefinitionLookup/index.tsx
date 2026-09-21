import {
  autoUpdate,
  type ComputePositionReturn,
  computePosition,
  offset,
  shift,
} from '@floating-ui/dom';
import {
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { styled } from 'solid-styled-components';
import { usePdfDocument } from '../../context/pdf-document-context';
import { usePdfViewer } from '../../context/pdf-viewer-context';
import type Term from '../../model/Term';
import { usePopupStore } from '../../signal/definitionPopup';
import { useIsPopup } from '../../signal/pdfViewer';
import { useGoToLocation } from '../../signal/tab';
import { CoParseClassName } from '../../type/coParse';
import TocUtils from '../../util/TocUtils';
import { DefinitionsAccordion } from './DefinitionsAccordion';
import { ReferencesAccordion } from './ReferencesAccordion';
import { parseDefinitionMetadata } from './shared';

const DefinitionLabelWrapper = styled.div`
  margin-right: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DefinitionLabel = styled.p`
  padding: 12px 2px 0 8px;
  font-weight: bold;
  font-style: normal;
  font-size: 16px;
  line-height: 1.5;
  display: block;
  align-items: center;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Card = styled.div<{ isPinsWindow: boolean }>`
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border-radius: 2px;
  ${({ isPinsWindow }) =>
    isPinsWindow
      ? `
    width: 100%;
    padding-bottom: 5px;
    box-shadow: 0 3.2px 7.2px 0 rgba(0,0,0,.05), 0 0.6px 1.8px 0 rgba(0,0,0,.108);
  `
      : 'box-shadow: 0 25.6px 57.6px 0 rgba(0, 0, 0, 0.22), 0 4.8px 14.4px 0 rgba(0, 0, 0, 0.18);border: 1px solid rgb(108, 117, 125);'}
`;

const TabButton = styled.button<{ isActive: boolean }>`
  font-size: 14px;
  line-height: 14px;
  padding: 12px 2px 6px 2px;
  margin: 0px 6px 6px 2px;
  border-width: 0px 0px 2px 0px;
  border-radius: 4px;
  :focus {
    outline: 0;
  }
  border-color: ${({ isActive }) => (isActive ? '#6495ED' : 'transparent')};
`;

type IProps = {
  index: number;
  term: Term;
} & (
  | {
      isPinsWindow: false;
      addNextTerm?: (term: Term) => void;
      removeNextTerms?: (index: number) => void;
      anchorRef: Element | null;
    }
  | {
      isPinsWindow: true;
      addNextTerm?: never;
      removeNextTerms?: never;
      anchorRef?: never;
    }
);

export function DefinitionLookup(props: IProps) {
  const pdf = usePdfDocument();
  const popupOpen = usePdfViewer().isPopupOpen;
  const isPopup = useIsPopup();
  const popupStore = usePopupStore(isPopup);
  const termIDToSizingMap = popupStore.termIDToSizingMap;
  const terms = popupStore.terms;

  let termRef: HTMLDivElement | undefined;
  const pageWidth = popupStore.pageWidth;
  const [coord, setCoord] = createStore<
    Omit<ComputePositionReturn, 'middlewareData'> &
      Partial<Pick<ComputePositionReturn, 'middlewareData'>>
  >({
    x: 0,
    y: 0,
    placement: 'bottom',
    strategy: 'absolute',
    middlewareData: undefined,
  });
  const updatePosition = () => {
    if (!props.anchorRef || !termRef) return;

    computePosition(props.anchorRef, termRef, {
      placement: 'bottom',
      strategy: 'absolute',
      middleware: [offset(props.index === 0 ? 2 : 8), shift({ padding: 8 })],
    }).then(setCoord);
  };
  createEffect((prevPageWidth) => {
    const newPageWidth = pageWidth();
    if (!props.anchorRef || !termRef) return prevPageWidth;
    if (newPageWidth === prevPageWidth) return prevPageWidth;

    const cleanup = autoUpdate(props.anchorRef, termRef, updatePosition);
    onCleanup(() => {
      cleanup();
    });

    return newPageWidth;
  });

  const [activeTab, setActiveTab] = createSignal<
    'DEFINITION_TAB' | 'REFERENCE_TAB'
  >('DEFINITION_TAB');

  const sizing = () =>
    props.term?.id ? termIDToSizingMap()[props.term.id] : undefined;

  const openLocation = useGoToLocation();

  const onClick: JSX.EventHandler<HTMLElement, MouseEvent> = async (e) => {
    const tgt = e.target;
    const { id, className } = parseDefinitionMetadata(tgt);

    if (className === CoParseClassName.SectionReference) {
      e.stopPropagation();
      const idToSectionMap = pdf.outline.sectionReferenceMap();
      const section = TocUtils.getSection({ id, idToSectionMap });
      openLocation({
        newTab: true,
        pageIndex: section.page,
        yPos: section.y,
        callout: 40,
      });
    } else if (className === CoParseClassName.TermReference) {
      e.stopPropagation();
      const term = pdf.definitions.getTerm(`${id}`);
      if (!term) {
        console.error('Term not found');
        return;
      }

      if (props.isPinsWindow) return;
      props.addNextTerm?.(term);
    } else {
      e.stopPropagation();
      // NOTE this only applies in the non-pins case
      // Clicked on card but not on section or term. Remove next term if it's being shown.
      props.removeNextTerms?.(props.index);
    }
  };

  const nextTerm = () =>
    props.isPinsWindow ? null : (terms()[props.index + 1] ?? null);

  const styles: () => JSX.CSSProperties = createMemo(() => {
    if (props.isPinsWindow)
      return {
        width: '100%',
        display: 'block',
      };

    return {
      opacity: coord.middlewareData ? '1' : '0',
      position: coord.strategy,
      top: '0px',
      left: '0px',
      transform: `translate3d(${Math.round(coord.x)}px,${Math.round(
        coord.y
      )}px,0)`,
      width: sizing()?.width ? `${sizing()?.width}px` : undefined,
    };
  });

  return (
    <Show when={!isPopup || popupOpen()}>
      <div
        on:mousedown={(e) => {
          e.stopPropagation();
        }}
        on:mouseup={(e) => {
          e.stopPropagation();
        }}
        on:click={onClick}
        data-tut={props.term.name === 'CP Outside Date' ? 'Popup' : ''}
        ref={termRef}
        style={{
          ...styles(),
          'z-index': isPopup
            ? 'calc(var(--z-index-viewer-definition-lookup) + var(--z-index-popup-viewer))'
            : 'var(--z-index-viewer-definition-lookup)',
        }}
      >
        <Card class="pinned-terms shadow-lg" isPinsWindow={props.isPinsWindow}>
          <div style={{ display: 'flex', 'justify-content': 'flex-end' }}>
            <DefinitionLabelWrapper>
              <DefinitionLabel>{props.term.name}</DefinitionLabel>
            </DefinitionLabelWrapper>
            <div style={{ display: 'flex' }}>
              <TabButton
                class="definition-popup-tab-button"
                isActive={activeTab() === 'DEFINITION_TAB'}
                on:click={() => setActiveTab('DEFINITION_TAB')}
              >
                Terms
              </TabButton>
              <TabButton
                class="definition-popup-tab-button"
                isActive={activeTab() === 'REFERENCE_TAB'}
                on:click={() => setActiveTab('REFERENCE_TAB')}
              >
                Uses
              </TabButton>
            </div>
          </div>
          <Switch>
            <Match when={activeTab() === 'DEFINITION_TAB'}>
              <DefinitionsAccordion
                term={props.term}
                truncated={sizing()?.truncated ?? false}
                getTerm={pdf.definitions.getTerm}
                onClick={onClick}
              />
            </Match>
            <Match when={activeTab() === 'REFERENCE_TAB'}>
              <ReferencesAccordion term={props.term} />
            </Match>
          </Switch>
        </Card>
      </div>
      <Show when={!props.isPinsWindow && nextTerm()}>
        {(nextTerm) => (
          <DefinitionLookup
            isPinsWindow={false}
            addNextTerm={props.addNextTerm}
            removeNextTerms={props.removeNextTerms}
            index={props.index + 1}
            term={nextTerm()}
            anchorRef={termRef!}
          />
        )}
      </Show>
    </Show>
  );
}
