import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';
import type { ReviewsScope } from './reviews-types';

export const reviewsTabSearch = {
  namespace: 'reviews',
  schema: z.object({
    tab: z.enum([
      'all',
      'authored',
      'assigned',
      'involving',
      'review_requests',
    ]),
  }),
  defaults: { tab: 'involving' as ReviewsScope },
};

export const reviewsTabSearchCodec = createSearchParamsCodec(reviewsTabSearch);
