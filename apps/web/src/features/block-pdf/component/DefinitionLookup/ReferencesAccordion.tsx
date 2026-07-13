import { Accordion } from '@kobalte/core/accordion';
import { Scrollbars } from 'solid-custom-scrollbars';
import { createSignal, Index } from 'solid-js';
import { styled } from 'solid-styled-components';
import Reference from '../../model/Reference';
import type Term from '../../model/Term';
import { useTableOfContentsValue } from '../../store/tableOfContents';
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
  const tableOfContents = useTableOfContentsValue();
  const idToSectionMap = () => tableOfContents().idToSectionMap;

  const references = () =>
    Array.from(props.term.references).map((e) =>
      Reference.fromXML(e, {
        idToSectionMap: idToSectionMap(),
      })
    );

  const [expandedItem, setExpandedItem] = createSignal(['0']);

  return (
    <>
      <DefinitionCount>
        Found {references().length} reference
        {references().length > 1 || references().length === 0 ? 's' : ''}
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
              let text = 'On page ' + (r().pageNum + 1);
              if (r().sectionName) {
                text = `In ${r().sectionName} on page ${r().pageNum + 1}`;
              }
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
                      <AccordionText>{text}</AccordionText>
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
