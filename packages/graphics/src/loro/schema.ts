import { type InferType, schema } from '@loro-mirror/core';
import type { Matrix } from '../core/affine';
import { type ShapeLabel, validShapeLabel } from '../core/shapes/label';

/** Geometry is validated per kind when projected, so newer kinds stay readable. */
type Pose = {
  parentId: string;
  transform: Matrix;
  world: Matrix;
  geometry: object | null;
};
function isMatrix(value: unknown): value is Matrix {
  return (
    Array.isArray(value) &&
    value.length === 6 &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v))
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
    (value.geometry === null || typeof value.geometry === 'object')
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

/** Preserve the deployed map registers; pose and label style remain atomic JSON.
 * Kinds are open: clients skip and preserve kinds added after they shipped. */
export const canvasNodeSchema = schema.LoroMap({
  id: schema.String({ required: true }),
  kind: schema.Value(
    (value): value is string => typeof value === 'string' && !!value,
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
