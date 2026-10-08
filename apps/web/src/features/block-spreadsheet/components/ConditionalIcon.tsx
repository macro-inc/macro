import type { Icon } from '@ironcalc/wasm';
import ArrowDown from '@phosphor-fill/arrow-down-fill.svg';
import ArrowDownRight from '@phosphor-fill/arrow-down-right-fill.svg';
import ArrowRight from '@phosphor-fill/arrow-right-fill.svg';
import ArrowUp from '@phosphor-fill/arrow-up-fill.svg';
import ArrowUpRight from '@phosphor-fill/arrow-up-right-fill.svg';
import Check from '@phosphor-fill/check-fill.svg';
import Circle from '@phosphor-fill/circle-fill.svg';
import Diamond from '@phosphor-fill/diamond-fill.svg';
import ExclamationMark from '@phosphor-fill/exclamation-mark-fill.svg';
import Flag from '@phosphor-fill/flag-fill.svg';
import Heart from '@phosphor-fill/heart-fill.svg';
import Minus from '@phosphor-fill/minus-fill.svg';
import Star from '@phosphor-fill/star-fill.svg';
import ThumbsDown from '@phosphor-fill/thumbs-down-fill.svg';
import ThumbsUp from '@phosphor-fill/thumbs-up-fill.svg';
import Triangle from '@phosphor-fill/triangle-fill.svg';
import X from '@phosphor-fill/x-fill.svg';
import type { Component, JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';

const ICONS: Record<
  Icon,
  [Component<JSX.SvgSVGAttributes<SVGSVGElement>>, string?]
> = {
  ArrowUp: [ArrowUp],
  ArrowRight: [ArrowRight],
  ArrowDown: [ArrowDown],
  ArrowAngleUp: [ArrowUpRight],
  ArrowAngleDown: [ArrowDownRight],
  Circle: [Circle],
  TriangleUp: [Triangle],
  TriangleDown: [Triangle, 'rotate-180'],
  TriangleUpFilled: [Triangle],
  TriangleDownFilled: [Triangle, 'rotate-180'],
  FlatRectangle: [Minus],
  Rhombus: [Diamond],
  Flag: [Flag],
  Check: [Check],
  Cross: [X],
  Exclamation: [ExclamationMark],
  Star: [Star],
  Heart: [Heart],
  ThumbsUp: [ThumbsUp],
  ThumbsDown: [ThumbsDown],
};

/** An Excel icon set's icon, drawn at the left of its cell. */
export function ConditionalIcon(props: { name: Icon; color: string }) {
  return (
    <Dynamic
      component={ICONS[props.name]?.[0] ?? Circle}
      aria-hidden="true"
      class={`pointer-events-none absolute left-0.5 top-1/2 size-3.5 -translate-y-1/2 ${ICONS[props.name]?.[1] ?? ''}`}
      style={{ color: props.color }}
    />
  );
}
