/** The layers panel icon for a layer type, as Figma draws them. */

import type { NodeType } from '@core/fig-engine/types';
import Circle from '@phosphor/circle.svg';
import Diamond from '@phosphor/diamond.svg';
import DiamondsFour from '@phosphor/diamonds-four.svg';
import FrameCorners from '@phosphor/frame-corners.svg';
import Hash from '@phosphor/hash.svg';
import Knife from '@phosphor/knife.svg';
import LineSegment from '@phosphor/line-segment.svg';
import PenNib from '@phosphor/pen-nib.svg';
import Polygon from '@phosphor/polygon.svg';
import Selection from '@phosphor/selection.svg';
import Shapes from '@phosphor/shapes.svg';
import Square from '@phosphor/square.svg';
import Star from '@phosphor/star.svg';
import TextT from '@phosphor/text-t.svg';
import Unite from '@phosphor/unite.svg';
import type { Component, JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';

const ICONS: Partial<
  Record<NodeType, Component<JSX.SvgSVGAttributes<SVGSVGElement>>>
> = {
  FRAME: Hash,
  GROUP: Selection,
  SECTION: FrameCorners,
  SYMBOL: DiamondsFour,
  INSTANCE: Diamond,
  TEXT: TextT,
  RECTANGLE: Square,
  ROUNDED_RECTANGLE: Square,
  ELLIPSE: Circle,
  LINE: LineSegment,
  STAR: Star,
  REGULAR_POLYGON: Polygon,
  VECTOR: PenNib,
  BOOLEAN_OPERATION: Unite,
  SLICE: Knife,
};

export function LayerIcon(props: { type: NodeType; class?: string }) {
  return (
    <Dynamic
      component={ICONS[props.type] ?? Shapes}
      class={props.class ?? 'size-3.5 shrink-0'}
    />
  );
}

/** Components and their instances are purple in Figma's layer list. */
export const isComponentType = (type: NodeType) =>
  type === 'SYMBOL' || type === 'INSTANCE';
