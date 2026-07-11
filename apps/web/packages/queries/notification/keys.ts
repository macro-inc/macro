import { createQueryKeys } from '@lukemorales/query-key-factory';

export const notificationKeys = createQueryKeys('notification', {
  all: null,
  user: (params: { limit?: number }) => ({
    queryKey: ['user', { infinite: true, ...params }],
  }),
  entity: (params: { eventItemId: string; limit?: number }) => ({
    queryKey: [
      'entity',
      params.eventItemId,
      { infinite: true, limit: params.limit },
    ],
  }),
  entities: (params: { eventItemIds: string[]; limit?: number }) => ({
    queryKey: ['entities', { infinite: true, ...params }],
  }),
  unsubscribes: null,
});
