/** The layers panel icon for a layer type, as Figma draws them. */

import type { NodeType } from '@core/fig-engine/types';
import Circle from '@icon/system/regular/circle.svg';
import Diamond from '@icon/system/regular/diamond.svg';
import DiamondsFour from '@icon/system/regular/diamonds-four.svg';
import FrameCorners from '@icon/system/regular/frame-corners.svg';
import Hash from '@icon/system/regular/hash.svg';
import Knife from '@icon/system/regular/knife.svg';
import LineSegment from '@icon/system/regular/line-segment.svg';
import PenNib from '@icon/system/regular/pen-nib.svg';
import Polygon from '@icon/system/regular/polygon.svg';
import Selection from '@icon/system/regular/selection.svg';
import Shapes from '@icon/system/regular/shapes.svg';
import Square from '@icon/system/regular/square.svg';
import Star from '@icon/system/regular/star.svg';
import TextT from '@icon/system/regular/text-t.svg';
import Unite from '@icon/system/regular/unite.svg';
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
