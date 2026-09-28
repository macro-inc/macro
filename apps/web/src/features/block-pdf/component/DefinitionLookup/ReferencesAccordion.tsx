import { Accordion } from '@kobalte/core/accordion';
import { Scrollbars } from 'solid-custom-scrollbars';
import { createMemo, createSignal, Index, Show } from 'solid-js';
import { styled } from 'solid-styled-components';
import { usePdfDocument } from '../../context/pdf-document-context';
import Reference from '../../model/Reference';
import type Term from '../../model/Term';
import { OpenRefInNewTabIcon } from './OpenRefInNewTabIcon';
import {
  AccordionText,
  accordionCardStyles,
  accordionCollapseStyles,
  accordionHeadStyles,
} from './shared';

const BootstrapCard = styled.div`
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border-radius: 2px;
`;

const DefinitionCount = styled.div`
  padding: 8px;
  font-size: 14px;
  font-weight: bold;
`;

interface IProps {
  term: Term;
}

export function ReferencesAccordion(props: IProps) {
  const idToSectionMap = usePdfDocument().outline.sectionReferenceMap;
  const references = createMemo(() =>
    Array.from(props.term.references).map(Reference.fromXML)
  );

  const [expandedItem, setExpandedItem] = createSignal(['0']);

  return (
    <>
      <DefinitionCount>
        Found {references().length} reference
        <Show when={references().length !== 1}>s</Show>
      </DefinitionCount>
      <Scrollbars
        autoHide
        autoHideTimeout={1000}
        autoHideDuration={200}
        autoHeight
        autoHeightMin={0}
        autoHeightMax={300}
      >
        <Accordion value={expandedItem()} onChange={setExpandedItem}>
          <Index each={references()}>
            {(r, idx) => {
              const section = () => {
                const sectionId = r().sectionId;
                if (sectionId == null) return;
                return idToSectionMap()[sectionId];
              };

              return (
                <Accordion.Item value={idx.toString()}>
                  <BootstrapCard
                    class={'pinned-terms'}
                    style={accordionCardStyles}
                  >
                    <button
                      class="flex flex-row w-full justify-between"
                      style={accordionHeadStyles}
                      on:click={(e) => {
                        e.stopPropagation();
                        setExpandedItem([idx.toString()]);
                      }}
                    >
                      <AccordionText>
                        <Show
                          when={section()}
                          fallback={<>On page {r().pageNum + 1}</>}
                        >
                          {(section) => (
                            <>
                              In {section().fullDescriptor} on page{' '}
                              {r().pageNum + 1}
                            </>
                          )}
                        </Show>
                      </AccordionText>
                      <OpenRefInNewTabIcon reference={r()} term={props.term} />
                    </button>
                    <Accordion.Content>
                      <div style={accordionCollapseStyles}>{r().context}</div>
                    </Accordion.Content>
                  </BootstrapCard>
                </Accordion.Item>
              );
            }}
          </Index>
        </Accordion>
      </Scrollbars>
    </>
  );
}
