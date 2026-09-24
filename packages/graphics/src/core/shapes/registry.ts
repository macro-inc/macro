import type { GraphicsItem, ShapeItem, ShapeKind } from '../model';
import type { ShapeDefinition } from './definition';
import { ellipseDefinition } from './ellipse';
import { rectangleDefinition } from './rectangle';

/** Explicit compile-time registration; kind and definition must agree. */
export const shapeDefinitions: {
  readonly [K in ShapeKind]: ShapeDefinition<K>;
} = Object.freeze({
  rectangle: rectangleDefinition,
  ellipse: ellipseDefinition,
});
export const shapeKinds = Object.freeze(
  Object.keys(shapeDefinitions) as ShapeKind[]
);
export const isShapeKind = (value: unknown): value is ShapeKind =>
  typeof value === 'string' && Object.hasOwn(shapeDefinitions, value);
export const isShape = (item: GraphicsItem | undefined): item is ShapeItem =>
  !!item && isShapeKind(item.type);
export function shapeDefinition<K extends ShapeKind>(
  kind: K
): ShapeDefinition<K> {
  // The mapped registry enforces this key/item correlation at registration.
  return shapeDefinitions[kind] as ShapeDefinition<K>;
}
