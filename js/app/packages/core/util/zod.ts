import { z } from 'zod';

const datelike = z.union([z.number(), z.string(), z.date()]);
/** Safely coerces a date-like value to a Date object. */
export const toZodDate = datelike.pipe(z.coerce.date());

/** Safely coerces a number-like value to a number.  */
export const toZodNumber = z.number().or(z.string()).pipe(z.coerce.number());

/** Safely coerces a number-like set to Set<number>.  */
export const toZodNumberSet = z
  .union([z.set(z.number()), z.array(z.number())])
  .transform((data) => (data instanceof Set ? data : new Set(data)));
