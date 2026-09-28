import { type Component, createMemo } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { Matrix } from '../core/affine';
import { cssMatrix } from '../core/affine';
import { resolveAppearance } from '../core/appearance';
import type { ShapeItem, ShapeKind } from '../core/model';
import { connectorPath } from '../core/shapes/connector-routing';
import { pencilInk } from '../core/shapes/pencil';

type OutlineProps<K extends ShapeKind = ShapeKind> = { item: ShapeItem<K> };

/** Geometry-only indicators, independent of content renderers and appearance opacity. */
const outlines: { [K in ShapeKind]: Component<OutlineProps<K>> } = {
  connector: (props) => (
    <path
      d={
        connectorPath(
          props.item.geometry.start,
          props.item.geometry.end,
          props.item.geometry.route
        ).path
      }
      vector-effect="non-scaling-stroke"
    />
  ),
  image: (props) => (
    <rect
      width={props.item.geometry.width}
      height={props.item.geometry.height}
      vector-effect="non-scaling-stroke"
    />
  ),
  video: (props) => (
    <rect
      width={props.item.geometry.width}
      height={props.item.geometry.height}
      vector-effect="non-scaling-stroke"
    />
  ),
  document: (props) => (
    <rect
      width={props.item.geometry.width}
      height={props.item.geometry.height}
      vector-effect="non-scaling-stroke"
    />
  ),
  text: (props) => (
    <rect
      width={props.item.geometry.width}
      height={props.item.geometry.height}
      vector-effect="non-scaling-stroke"
    />
  ),
  rectangle: (props) => (
    <rect
      width={props.item.geometry.width}
      height={props.item.geometry.height}
      rx={Math.min(
        resolveAppearance(props.item.appearance).cornerRadius,
        props.item.geometry.width / 2,
        props.item.geometry.height / 2
      )}
      vector-effect="non-scaling-stroke"
    />
  ),
  ellipse: (props) => (
    <ellipse
      cx={props.item.geometry.width / 2}
      cy={props.item.geometry.height / 2}
      rx={props.item.geometry.width / 2}
      ry={props.item.geometry.height / 2}
      vector-effect="non-scaling-stroke"
    />
  ),
  pencil: (props) => {
    const ink = createMemo(() => pencilInk(props.item));
    return <path d={ink().centerline} vector-effect="non-scaling-stroke" />;
  },
};

/** SVG transforms keep stroke thickness at one screen pixel through any scene transform. */
export function ShapeSelectionOutline<K extends ShapeKind>(
  props: OutlineProps<K> & {
    transform: Matrix;
    color: string;
    hovered?: boolean;
  }
) {
  // The mapped registry pairs every shape kind with its typed outline.
  const renderer = () =>
    outlines[props.item.type] as Component<OutlineProps<K>>;
  return (
    <g
      data-graphics-selection-outline={
        props.hovered ? undefined : props.item.id
      }
      data-graphics-hover-outline={props.hovered ? props.item.id : undefined}
      transform={cssMatrix(props.transform)}
      fill="none"
      stroke={props.color}
      stroke-width="1"
      stroke-linecap="round"
      stroke-linejoin="round"
      pointer-events="none"
    >
      <Dynamic component={renderer()} item={props.item} />
    </g>
  );
}
