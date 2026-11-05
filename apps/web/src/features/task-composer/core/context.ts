import type { PropertyApiValues } from '@property/types';

/** Plain, cloneable preset data supplied by the originating view. */
export type TaskComposerContext = {
  key: string;
  visiblePropertyIds?: string[];
  initialPropertyValues?: Record<string, PropertyApiValues>;
  /** Replace the Companies and Contacts pills with one Customer / Contact pill. */
  showCustomerContact?: boolean;
};
