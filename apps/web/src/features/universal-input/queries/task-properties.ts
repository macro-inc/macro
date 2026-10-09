import type { PropertyApiValues } from '@property/types';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { z } from 'zod';

const property = z.discriminatedUnion('valueType', [
  z.object({ valueType: z.literal('STRING'), value: z.string().nullable() }),
  z.object({ valueType: z.literal('NUMBER'), value: z.number().nullable() }),
  z.object({ valueType: z.literal('DATE'), value: z.coerce.date().nullable() }),
  z.object({ valueType: z.literal('BOOLEAN'), value: z.boolean().nullable() }),
  z.object({
    valueType: z.literal('SELECT_STRING'),
    values: z.array(z.string()).nullable(),
  }),
  z.object({
    valueType: z.literal('SELECT_NUMBER'),
    values: z.array(z.string()).nullable(),
  }),
  z.object({
    valueType: z.literal('LINK'),
    values: z.array(z.string()).nullable(),
  }),
  z.object({
    valueType: z.literal('ENTITY'),
    refs: z
      .array(
        z.object({ entity_id: z.string(), entity_type: z.enum(EntityType) })
      )
      .nullable(),
  }),
]);

export function parseTaskProperties(
  value: string
): Record<string, PropertyApiValues> {
  if (!value) return {};
  try {
    return z.record(z.string(), property).parse(JSON.parse(value));
  } catch {
    return {};
  }
}
