import { z } from 'zod';

/** A dock search starts a new visit without changing the Search URL. */
export const mobileSearchRouteStateSchema = z.object({
  sessionId: z.string().min(1),
});

export type MobileSearchRouteState = z.infer<
  typeof mobileSearchRouteStateSchema
>;
