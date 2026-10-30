import { z } from 'zod';

/** Preserve a valid stored value, falling back only when validation fails. */
export function schemaWithFallback<T>(
  schema: z.ZodType<T>,
  fallback: NoInfer<T>
) {
  return z.unknown().transform((value): T => {
    const result = schema.safeParse(value);
    return result.success ? result.data : fallback;
  });
}
