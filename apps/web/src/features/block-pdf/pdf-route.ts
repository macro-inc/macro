import { createSearchParamsCodec } from '@app/split-router';
import { z } from 'zod';

export const pdfDetailSearch = {
  namespace: 'pdf-detail',
  schema: z.object({
    documentId: z.string(),
    page: z.number().int().nonnegative(),
    highlightTerms: z.array(z.string()),
    snippet: z.string(),
    query: z.string(),
    seek: z.string(),
  }),
  defaults: {
    documentId: '',
    page: 0,
    highlightTerms: [] as string[],
    snippet: '',
    query: '',
    seek: '',
  },
};

export const pdfDetailSearchCodec = createSearchParamsCodec(pdfDetailSearch);
