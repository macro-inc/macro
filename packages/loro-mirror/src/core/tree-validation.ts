import type { SchemaType } from '../schema/types';
import { assertTree } from '../schema/validators';

/** Structural checks still apply when optional scalar validation is disabled. */
export function validateProposedTrees(
  schema: SchemaType | undefined,
  value: unknown
): void {
  if (!schema) return;
  if (schema.type === 'loro-tree') {
    assertTree(schema, value);
    return;
  }
  if (value === undefined || value === null) return;
  if (
    (schema.type === 'schema' || schema.type === 'loro-map') &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    for (const [key, field] of Object.entries(schema.definition)) {
      if (key in value) {
        const child: unknown = Reflect.get(value, key);
        if (child === undefined && schema.type === 'loro-map') continue;
        validateProposedTrees(field, child);
      } else if (schema.type === 'schema' && field.type === 'loro-tree') {
        throw new Error(
          'Native root trees cannot be removed; use an empty forest'
        );
      }
    }
  } else if (
    (schema.type === 'loro-list' || schema.type === 'loro-movable-list') &&
    Array.isArray(value)
  ) {
    for (const item of value) validateProposedTrees(schema.itemSchema, item);
  }
}
