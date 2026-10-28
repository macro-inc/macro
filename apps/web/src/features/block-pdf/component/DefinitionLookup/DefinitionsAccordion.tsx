import { Accordion } from '@kobalte/core/accordion';
import { cn } from '@ui';
import Scrollbars from 'solid-custom-scrollbars';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { styled } from 'solid-styled-components';
import { usePdfDocument } from '../../context/pdf-document-context';
import {
  Color,
  determineFormat,
  hexToRgb,
  type IColor,
} from '../../model/Color';
import type Term from '../../model/Term';
import { CoParseClassName } from '../../type/coParse';
import { decodeDefinitionText } from '../../util/definitionText';
import TocUtils from '../../util/TocUtils';
import { OpenRefInNewTabIcon } from './OpenRefInNewTabIcon';
import {
  AccordionText,
  accordionCardStyles,
  accordionCollapseStyles,
  accordionHeadStyles,
  FONT_SIZE,
  LINE_HEIGHT,
} from './shared';

// Default delimiter used to pass colors to definition popups
// Make sure this delimiter matches the value in SafeWriter.java
const COLORDELIMITER = '%%MACRO_COLOR_DELIMITER%%';
const BOLDDELIMITER = '%%MACRO_BOLD_DELIMITER%%';
const ITALICDELIMITER = '%%MACRO_ITALIC_DELIMITER%%';
const htmlSpecialEntities = [
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
];
const SECTION_MAX_CHARS = 80;

const BootstrapCard = styled.div`
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border-radius: 2px;
`;

const DefinitionText = styled.p<{ truncated: boolean }>`
  padding: 0px 8px 0px 8px;
  font-family: Helvetica;
  font-style: normal;
  font-weight: normal;
  cursor: text;
  user-select: text;
  font-size: ${FONT_SIZE.toString()}px;
  line-height: ${LINE_HEIGHT.toString()};
  display: inline-block;
  align-items: center;
  letter-spacing: 0.02em;
  overflow: hidden;
  margin: 0;
`;

const HoverText = styled.span<{
  color: string;
  hoverColor: string;
  class: string;
}>`
  color: ${(props) => props.color};
  cursor: pointer;
`;

function filterUniqueTerms(terms: (Term | null)[]): Term[] {
  let uniqueObj: { [key: string]: Term } = {};
  terms.forEach((t) => {
    if (t) {
      let hash = t.name + t.pageNum.toString() + t.yPos.toString();
      uniqueObj[hash] = t;
    }
  });
  let uniqueTerms: Term[] = Object.values(uniqueObj);
  return uniqueTerms;
}

function truncateSectionDescriptor(descriptor: string): string {
  if (descriptor.length <= SECTION_MAX_CHARS) return descriptor;
  return `${descriptor.substring(0, SECTION_MAX_CHARS)}...`;
}

function computeRelatedTerms(
  term: Term,
  getTerm: (id: string) => Term | null
): Term[] {
  let simTerms: (Term | null)[] = term.sims.map(getTerm);
  simTerms.unshift(term);
  return filterUniqueTerms(simTerms);
}

interface IProps {
  truncated: boolean;
  term: Term;
  getTerm: (id: string) => Term | null;
  onClick: JSX.EventHandler<HTMLElement, MouseEvent>;
}

export function DefinitionsAccordion(props: IProps) {
  const idToSectionMap = usePdfDocument().outline.sectionReferenceMap;
  const terms = createMemo(() =>
    computeRelatedTerms(props.term, props.getTerm)
  );

  const constructSpans = (elArr: ChildNode[]) => {
    const spans = elArr.map((el, _idx) => {
      const element = el as Element;
      const decodedString = decodeDefinitionText(element);
      const className = element.getAttribute('class');
      const isSection = className === CoParseClassName.SectionReference;
      const decodedStringArray = decodedString.split(COLORDELIMITER);
      decodedStringArray.shift();
      const colorArray: IColor[] = [];
      const textArray: string[] = [];

      decodedStringArray.forEach((decodedString, index) => {
        if (index % 2 === 0) {
          colorArray.push(hexToRgb(decodedString, 1));
        } else {
          textArray.push(decodedString);
        }
      });

      const content: JSX.Element[] = [];

      if (textArray.length > 0 && textArray.length === colorArray.length) {
        textArray.forEach((snippet, index) => {
          const isBold = snippet.includes(BOLDDELIMITER);
          const isItalic = snippet.includes(ITALICDELIMITER);
          let snippetText = snippet
            .replaceAll(BOLDDELIMITER, '')
            .replaceAll(ITALICDELIMITER, '');
          htmlSpecialEntities.forEach((entity) => {
            snippetText = snippetText.replaceAll(entity[0], entity[1]);
          });
          if (isSection || className === CoParseClassName.TermReference) {
            const classID = element.getAttribute(isSection ? 'secId' : 'defId');
            const id = `${className}_${classID}`;
            content.push(
              <HoverText
                id={id}
                // TODO use CSS variables or constants for colors
                color={
                  isSection
                    ? '#00A400'
                    : determineFormat(colorArray[index]).includes(
                          'line-through'
                        )
                      ? '#FE2EA0 !important'
                      : '#1447A6'
                }
                hoverColor={
                  isSection
                    ? '#014f01'
                    : determineFormat(colorArray[index]).includes(
                          'line-through'
                        )
                      ? '#FF0405 !important'
                      : '#EC008C'
                }
                onClick={props.onClick}
                class={cn('pinned-terms-section', className)}
                style={{
                  // TODO: Remove following "fake" strikeouts, underlines setting and properly pull from backend
                  'text-decoration-line': determineFormat(colorArray[index]),
                  'font-weight': isBold ? 'bold' : 'normal',
                  'font-style': isItalic ? 'italic' : 'normal',
                  'white-space': 'break-spaces',
                }}
              >
                {snippetText}
              </HoverText>
            );
          } else {
            content.push(
              <span
                style={{
                  color: Color.toRgbaString(colorArray[index]),
                  // TODO: Remove following "fake" strikeouts, underlines setting and properly pull from backend
                  'text-decoration-line': determineFormat(colorArray[index]),
                  'font-weight': isBold ? 'bold' : 'normal',
                  'font-style': isItalic ? 'italic' : 'normal',
                  'white-space': 'break-spaces',
                }}
              >
                {snippetText}
              </span>
            );
          }
        });
      } else if (isSection || className === CoParseClassName.TermReference) {
        const classID = element.getAttribute(isSection ? 'secId' : 'defId');
        const id = `${className}_${classID}`;
        return (
          <HoverText
            id={id}
            // TODO use CSS variables or constants for colors
            color={isSection ? '#00A400' : '#1447A6'}
            hoverColor={isSection ? '#014f01' : '#EC008C'}
            onClick={props.onClick}
            class={cn('pinned-terms-section', className)}
          >
            {decodedString}
          </HoverText>
        );
      }
      if (content.length === 0) {
        return (
          <span style={{ 'white-space': 'pre-wrap' }}>{decodedString}</span>
        );
      }

      return <span>{content}</span>;
    });
    return spans;
  };

  const [expandedItem, setExpandedItem] = createSignal(['definitionCard0']);

  return (
    <Scrollbars
      autoHide
      autoHideTimeout={1000}
      autoHideDuration={200}
      autoHeight
      autoHeightMin={0}
      autoHeightMax={300}
      hideTracksWhenNotNeeded={true}
    >
      <Accordion value={expandedItem()} onChange={setExpandedItem}>
        <For each={terms()}>
          {(t, idx) => {
            const elArr = Array.from(t.definition.childNodes).filter((n) =>
              n.nodeName.includes('span')
            );
            const spans = constructSpans(elArr);
            const nearestSection = () =>
              TocUtils.getNearestSection({
                page: t.pageNum,
                yPos: t.yPos,
                idToSectionMap: idToSectionMap(),
              });

            return (
              <Accordion.Item value={'definitionCard' + idx()}>
                <BootstrapCard class="pinned-terms" style={accordionCardStyles}>
                  <Accordion.Header>
                    <button
                      style={accordionHeadStyles}
                      class="flex flex-row w-full justify-between"
                      on:click={(e) => {
                        e.stopPropagation();
                        setExpandedItem(['definitionCard' + idx()]);
                      }}
                    >
                      <AccordionText>
                        <Show
                          when={nearestSection()}
                          fallback={<>On page {t.pageNum + 1}</>}
                        >
                          {(section) => (
                            <>
                              In{' '}
                              {truncateSectionDescriptor(
                                section().fullDescriptor
                              )}{' '}
                              on page {t.pageNum + 1}
                            </>
                          )}
                        </Show>
                      </AccordionText>
                      <OpenRefInNewTabIcon reference={t} term={props.term} />
                    </button>
                  </Accordion.Header>
                  <Accordion.Content>
                    <BootstrapCard
                      style={accordionCollapseStyles}
                      class="border-t border-edge"
                    >
                      <DefinitionText truncated={props.truncated}>
                        <For each={spans}>{(span) => span}</For>
                      </DefinitionText>
                    </BootstrapCard>
                  </Accordion.Content>
                </BootstrapCard>
              </Accordion.Item>
            );
          }}
        </For>
      </Accordion>
    </Scrollbars>
  );
}
