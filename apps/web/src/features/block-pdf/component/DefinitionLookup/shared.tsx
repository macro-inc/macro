import type { JSX } from 'solid-js';
import { styled } from 'solid-styled-components';

export const AccordionText = styled('span')`
  line-height: 18px;
`;

export const FONT_SIZE = 16;
export const LINE_HEIGHT = 1.1;

export function parseDefinitionMetadata(element: Element): {
  className: string;
  id: number;
} {
  const split = element.id.split('_');
  const className = split[0];
  const id = parseInt(split[1], 10);
  return { className, id };
}

export const accordionCardStyles: JSX.CSSProperties = {
  'border-radius': 0,
  'border-width': '1px 0px',
};

export const accordionHeadStyles: JSX.CSSProperties = {
  padding: '4px 8px',
  'font-size': '12px',
  'line-height': '24px',
  display: 'flex',
};

export const accordionCollapseStyles: JSX.CSSProperties = {
  padding: '8px',
  'font-size': '14px',
  visibility: 'visible',
};
