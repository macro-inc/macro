import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';

export const agentDetailSearch = {
  namespace: 'agent-detail',
  schema: z.object({
    messageTurn: z.number().int().min(-1),
    author: z.enum(['user', 'agent']),
    seek: z.string(),
  }),
  defaults: { messageTurn: -1, author: 'user' as 'user' | 'agent', seek: '' },
};

export const agentDetailSearchCodec =
  createSearchParamsCodec(agentDetailSearch);
