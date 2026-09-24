import type { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { ShapeItem, ShapeKind } from '../core/model';
import { EllipseView } from './shapes/ellipse';
import { RectangleView } from './shapes/rectangle';

export type ShapeViewProps<K extends ShapeKind = ShapeKind> = {
  item: ShapeItem<K>;
  scale: number;
  preview?: boolean;
};
export type ItemRenderers = { [K in ShapeKind]: Component<ShapeViewProps<K>> };
export const defaultRenderers: ItemRenderers = {
  rectangle: RectangleView,
  ellipse: EllipseView,
};
export function ShapeView<K extends ShapeKind>(
  props: ShapeViewProps<K> & { renderers: ItemRenderers }
) {
  // The mapped registry guarantees each component receives its own typed item.
  const renderer = () =>
    props.renderers[props.item.type] as Component<ShapeViewProps<K>>;
  return (
    <Dynamic
      component={renderer()}
      item={props.item}
      scale={props.scale}
      preview={props.preview}
    />
  );
}
