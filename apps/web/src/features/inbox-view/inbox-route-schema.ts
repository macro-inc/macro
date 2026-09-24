import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import { BlockRegistry } from '@core/block';
import { z } from 'zod';

export const inboxPreviewRouteParams = z
  .object({
    blockType: z.enum(BlockRegistry),
    previewId: z.string().min(1),
  })
  .refine(
    ({ blockType, previewId }) =>
      blockType !== 'write' &&
      (blockType !== 'calendar' || previewId === CALENDAR_BLOCK_ID)
  );

export type InboxPreviewRouteParams = z.infer<typeof inboxPreviewRouteParams>;
