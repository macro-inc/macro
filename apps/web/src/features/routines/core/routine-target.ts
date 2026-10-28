import { z } from 'zod';

// Model IDs belong to the selected runtime, not a frontend catalog.
export const routineModelSchema = z
  .string()
  .refine((value) => value.trim().length > 0);
export const routineAgentIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const routineTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('model'), model: routineModelSchema }),
  z.strictObject({
    kind: z.literal('agent'),
    agentId: routineAgentIdSchema,
    modelOverride: routineModelSchema.optional(),
  }),
]);

export type RoutineTarget = z.infer<typeof routineTargetSchema>;

export function routineTargetsEqual(
  a: RoutineTarget,
  b: RoutineTarget
): boolean {
  if (a.kind === 'model') return b.kind === 'model' && a.model === b.model;
  return (
    b.kind === 'agent' &&
    a.agentId === b.agentId &&
    a.modelOverride === b.modelOverride
  );
}
