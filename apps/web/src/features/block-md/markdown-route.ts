import { createSearchParamsCodec } from '@app/split-router';
import { z } from 'zod';

export const markdownDetailSearch = {
  namespace: 'markdown-detail',
  schema: z.object({
    documentId: z.string(),
    nodeId: z.string(),
    seek: z.string(),
  }),
  defaults: { documentId: '', nodeId: '', seek: '' },
};

export const markdownDetailSearchCodec =
  createSearchParamsCodec(markdownDetailSearch);
