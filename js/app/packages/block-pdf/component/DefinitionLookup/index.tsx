import { ENABLE_PINS } from '@core/constant/featureFlags';
import {
  zPopupViewer,
  zViewerDefinitionLookup,
} from '@core/constant/stackingContext';
import {
  autoUpdate,
  type ComputePositionReturn,
  computePosition,
  offset,
  shift,
} from '@floating-ui/dom';
// import TiPin from '@icon/filled/push-pin.svg';
// import TiPinOutline from '@icon/regular/push-pin.svg';
import TiDeleteOutline from '@icon/regular/x-circle.svg';
import { createEffect, createMemo, type JSX, onCleanup, Show } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { styled } from 'solid-styled-components';
import type Section from '../../model/Section';
import type Term from '../../model/Term';
import { keyedTermDataStore } from '../../PdfViewer/TermDataStore';
import { popupOpen, useIsPopup } from '../../signal/pdfViewer';
import { useGoToLocation } from '../../signal/tab';
import { usePopupStore } from '../../store/definitionPopup';
import { useGetIdToSectionMap } from '../../store/tableOfContents';
import { CoParseClassName } from '../../type/coParse';
import TocUtils from '../../util/TocUtils';
import { DefinitionsAccordion } from './DefinitionsAccordion';
import { ReferencesAccordion } from './ReferencesAccordion';
import { parseDefinitionMetadata } from './shared';

// import { useOpenLocation } from '@app/atoms/tab';
// import { useDoEdit } from '@app/atoms/unsaved';
// import {
//   usePinnedTerms,
//   useWidgetDispatchContext,
// } from '../../context/WidgetContext';
// import { ILocation } from '../../models/Location';
// import SectionPreview from '../SectionPreview';

const iconStyles: JSX.CSSProperties = {
  'margin-right': '8px',
  'margin-top': '8px',
  cursor: 'pointer',
};

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
  // No box shadow, take full width, have padding if in pins window
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

export interface IState {
  left?: number;
  width?: number;
  activeTab: 'DEFINITION_TAB' | 'REFERENCE_TAB';

  // For section preview
  section: Section | null;
  hoveredDOMRect: DOMRect | null;
}

export function DefinitionLookup(props: IProps) {
  const isPopup = useIsPopup();
  const getIdToSectionMap = useGetIdToSectionMap();
  // popupAtoms => popupStore
  const popupStore = usePopupStore(isPopup);
  const termIDToSizingMap = popupStore.termIDToSizingMap;
  const terms = popupStore.terms;
  const termDataStore = keyedTermDataStore();
  // const widgetDispatch = useWidgetDispatchContext();
  // const pinnedTerms = usePinnedTerms();

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

  const [state, updateState] = createStore<IState>({
    hoveredDOMRect: null,
    section: null,
    activeTab: 'DEFINITION_TAB',
  });

  const sizing = () =>
    props.term?.id ? termIDToSizingMap()[props.term.id] : undefined;

  const openLocation = useGoToLocation();

  const onClick: JSX.EventHandler<HTMLElement, MouseEvent> = async (e) => {
    const tgt = e.target;
    const { id, className } = parseDefinitionMetadata(tgt);

    if (className === CoParseClassName.SectionReference) {
      e.stopPropagation();
      // when current TOC is using PDF bookmarks, use the AI TOC's ID-to-section
      // mapping since the section references are built from the AI TOC
      const idToSectionMap = getIdToSectionMap();
      const section = TocUtils.getSection({ id, idToSectionMap });
      openLocation({
        newTab: true,
        pageIndex: section.page,
        yPos: section.y,
        callout: 40,
      });
    } else if (className === CoParseClassName.TermReference) {
      e.stopPropagation();
      const term = termDataStore?.get('' + id);
      if (!term) {
        console.error('Term not found');
        return;
      }

      if (props.isPinsWindow) {
        // widgetDispatch({ type: 'ADD_PINNED_TERM', term, index: props.index });
      } else {
        props.addNextTerm?.(term);
      }
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
          'z-index': zViewerDefinitionLookup + (isPopup ? zPopupViewer : 0),
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
                isActive={state.activeTab === 'DEFINITION_TAB'}
                on:click={() =>
                  updateState(
                    produce((draft) => {
                      draft.activeTab = 'DEFINITION_TAB';
                    })
                  )
                }
              >
                Terms
              </TabButton>
              <TabButton
                class="definition-popup-tab-button"
                isActive={state.activeTab === 'REFERENCE_TAB'}
                on:click={() =>
                  updateState(
                    produce((draft) => {
                      draft.activeTab = 'REFERENCE_TAB';
                    })
                  )
                }
              >
                Uses
              </TabButton>
              <div>
                {ENABLE_PINS && (
                  // biome-ignore lint/complexity/noUselessFragments: fix later
                  <>
                    {props.isPinsWindow ? (
                      // <Tooltip
                      //   placement={'bottom'}
                      //   label={'Unpin this term'}
                      //   small={true}
                      // >
                      <span class="flex">
                        <TiDeleteOutline
                          // onClick={() => {
                          //   doEdit(
                          //     widgetDispatch({
                          //       type: 'REMOVE_PINNED_TERM',
                          //       term: props.term,
                          //     })
                          //   );
                          // }}
                          style={{
                            ...iconStyles,
                            width: '20px',
                            height: '20px',
                          }}
                        />
                      </span>
                      // </Tooltip>
                    ) : (
                      <div>
                        {/* {pinnedTerms
                            .map((t) => t.name)
                            .includes(props.term.name) ? (
                            // <Tooltip
                            //   placement={'bottom'}
                            //   label={'Unpin this definition'}
                            //   small={true}
                            // >
                            <span class="flex">
                              <TiPin
                                width="1.5em"
                                height="1.5em"
                                style={iconStyles}
                                class="text-success"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  doEdit(
                                    widgetDispatch({
                                      type: 'REMOVE_PINNED_TERM',
                                      term: props.term,
                                    })
                                  );
                                }}
                              />
                            </span>
                            // </Tooltip>
                          ) : (
                            // <Tooltip
                            //   placement={'bottom'}
                            //   label={'Pin this definition'}
                            //   small={true}
                            // >
                            <span class="flex">
                              <TiPinOutline
                                onClick={(e) => {
                                  e.stopPropagation();
                                  doEdit(
                                    widgetDispatch({
                                      type: 'ADD_PINNED_TERM',
                                      term: props.term,
                                      index: null,
                                    })
                                  );
                                }}
                                style={{
                                  ...iconStyles,
                                  width: '1.5em',
                                  height: '1.5em',
                                }}
                              />
                            </span>
                            // </Tooltip>
                          )} */}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          {state.activeTab === 'DEFINITION_TAB' ? (
            <DefinitionsAccordion
              term={props.term}
              truncated={sizing()?.truncated ?? false}
              onClick={onClick}
              setHoveredDOMRect={(hoveredDOMRect) =>
                updateState(
                  produce((draft) => {
                    draft.hoveredDOMRect = hoveredDOMRect;
                  })
                )
              }
              setSection={(section) =>
                updateState(
                  produce((draft) => {
                    draft.section = section;
                  })
                )
              }
            />
          ) : state.activeTab === 'REFERENCE_TAB' ? (
            <ReferencesAccordion term={props.term} />
          ) : null}
        </Card>
      </div>
      {/* <SectionPreview section={section} hoveredDOMRect={state.hoveredDOMRect} /> */}
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
