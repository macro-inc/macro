import type { JSX } from 'solid-js';

export type FloatingStyle = JSX.CSSProperties & {
  width: string;
};

export function getFloatingSearchHighlightPosition(
  targetRect: DOMRect | null,
  anchorElem: HTMLElement
): FloatingStyle {
  const scrollerElem = anchorElem.parentElement;
  if (targetRect === null || !scrollerElem) {
    return {
      opacity: '0',
      transform: 'translate(-10000px, -10000px)',
      width: '0',
      height: '0',
    };
  }

  const anchorElementRect = anchorElem.getBoundingClientRect();

  const top = targetRect.top - anchorElementRect.top;
  const left = targetRect.left - anchorElementRect.left;

  return {
    opacity: '1',
    width: `${targetRect.width}px`,
    height: `${targetRect.height}px`,
    transform: `translate(${left}px, ${top}px)`,
  };
}
