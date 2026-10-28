import { z } from 'zod';
import {
  DIFF_STYLES,
  type DiffStyle,
  PANE_LAYOUTS,
  type PaneLayout,
} from './core/layout';

/**
 * The Changes pane's view state in its split's own search params
 * (`s0.changes.pane=split`, `s0.changes.style=split`). A route that hosts the
 * pane lists this namespace in its `search`, so closing the split or
 * navigating it elsewhere drops the state with it.
 */
export const changesSearch = {
  namespace: 'changes',
  schema: z.object({
    pane: z.enum(PANE_LAYOUTS),
    style: z.enum(DIFF_STYLES),
  }),
  defaults: { pane: 'closed', style: 'unified' } as {
    pane: PaneLayout;
    style: DiffStyle;
  },
};
