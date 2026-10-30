import { type InferType, schema } from '@loro-mirror/core';
import type { Matrix } from '../core/affine';
import type { ShapeGeometryMap, ShapeKind } from '../core/model';
import { type ShapeLabel, validShapeLabel } from '../core/shapes/label';
import { isShapeKind, shapeDefinitions } from '../core/shapes/registry';

type Pose = {
  parentId: string;
  transform: Matrix;
  world: Matrix;
  geometry: ShapeGeometryMap[ShapeKind] | null;
};
function isMatrix(value: unknown): value is Matrix {
  return (
    Array.isArray(value) &&
    value.length === 6 &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v))
  );
}
function isGeometry(value: unknown): value is ShapeGeometryMap[ShapeKind] {
  return Object.values(shapeDefinitions).some((definition) =>
    definition.validateGeometry(value)
  );
}
function isPose(value: unknown): value is Pose {
  return (
    !!value &&
    typeof value === 'object' &&
    'parentId' in value &&
    typeof value.parentId === 'string' &&
    'transform' in value &&
    isMatrix(value.transform) &&
    'world' in value &&
    isMatrix(value.world) &&
    'geometry' in value &&
    (value.geometry === null || isGeometry(value.geometry))
  );
}
function isLabelStyle(
  value: unknown
): value is Omit<ShapeLabel, 'content'> | null {
  return (
    value === null ||
    (!!value &&
      typeof value === 'object' &&
      validShapeLabel({ ...value, content: '' }))
  );
}

/** Preserve the deployed map registers; pose and label style remain atomic JSON. */
export const canvasNodeSchema = schema.LoroMap({
  id: schema.String({ required: true }),
  kind: schema.Value(
    (value): value is ShapeKind | 'group' =>
      value === 'group' || isShapeKind(value),
    { required: true }
  ),
  pose: schema.Value(isPose, { required: true }),
  textContent: schema.Value(
    (value): value is string | null =>
      value === null || typeof value === 'string'
  ),
  labelStyle: schema.Value(isLabelStyle),
  fill: schema.String(),
  stroke: schema.String(),
  strokeWidth: schema.Number(),
  strokeStyle: schema.Value(
    (value): value is 'solid' | 'dashed' | 'dotted' =>
      value === 'solid' || value === 'dashed' || value === 'dotted'
  ),
  opacity: schema.Number(),
  cornerRadius: schema.Number(),
});
export type NodeData = InferType<typeof canvasNodeSchema>;
export const canvasSchema = schema(
  { scene: schema.LoroTree(canvasNodeSchema, (data) => data.id) },
  { allowUnknown: true }
);
export type CanvasForest = InferType<typeof canvasSchema>['scene'];
