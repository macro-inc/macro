import { z } from 'zod';
import {
  BOARD_VARIANTS,
  type BoardVariant,
  DEFAULT_BOARD_VARIANT,
} from './core/variants';

/** The Board's search namespace: which variant is showing. */
export const boardSearch = {
  namespace: 'board',
  schema: z.object({ variant: z.enum(BOARD_VARIANTS) }),
  defaults: { variant: DEFAULT_BOARD_VARIANT as BoardVariant },
};
