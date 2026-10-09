import type { GraphicsItem, ShapeItem, ShapeKind } from '../model';
import { connectorDefinition } from './connector';
import type { ShapeDefinition } from './definition';
import { ellipseDefinition } from './ellipse';
import {
  documentDefinition,
  imageDefinition,
  videoDefinition,
} from './embedded';
import { pencilDefinition } from './pencil';
import { rectangleDefinition } from './rectangle';
import { textDefinition } from './text';

/** Explicit compile-time registration; kind and definition must agree. */
export const shapeDefinitions: {
  readonly [K in ShapeKind]: ShapeDefinition<K>;
} = Object.freeze({
  connector: connectorDefinition,
  rectangle: rectangleDefinition,
  ellipse: ellipseDefinition,
  pencil: pencilDefinition,
  text: textDefinition,
  image: imageDefinition,
  video: videoDefinition,
  document: documentDefinition,
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

/** Validate the kind/geometry correlation at wire and clipboard boundaries. */
export function shapePayload<K extends ShapeKind>(kind: K, geometry: unknown) {
  const definition = shapeDefinition(kind);
  if (!definition.validateGeometry(geometry))
    throw new Error(`Invalid ${kind} geometry`);
  return { type: kind, geometry: definition.freezeGeometry(geometry) } as {
    [P in K]: Pick<ShapeItem<P>, 'type' | 'geometry'>;
  }[K];
}
