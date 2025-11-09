import {
  QueryClientProvider,
  type QueryObserverOptions,
} from '@tanstack/solid-query';
import deepEqual from 'fast-deep-equal';
import type { ParentProps } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { fetchApiToken } from '../queries/auth';
import { queryClient } from '../queries/client';
import { queryKeys } from '../queries/key';
import type { EntityData } from '../types/entity';

export function Provider(props: ParentProps) {
  queryClient.setQueryDefaults(queryKeys.all.auth, {
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 * 24, // 1 day
  });
  queryClient.setQueryDefaults(queryKeys.auth.apiToken, {
    queryFn: fetchApiToken,
  });

  queryClient.setQueryDefaults(queryKeys.all.entity, {
    reconcile: (oldData?: EntityData[], newData?: EntityData[]) => {
      if (!oldData || !newData) return newData;

      const unwrappedOldData = unwrap(oldData);
      return newData.map((entity) => {
        const oldEntity = unwrappedOldData.find(
          (oldEntity) => oldEntity.id === entity.id
        );
        if (oldEntity && deepEqual(oldEntity, entity)) {
          return oldEntity;
        }
        return entity;
      });
    },
    gcTime: 1000 * 60 * 60, // 1 hour
  } as Partial<QueryObserverOptions>);
  queryClient.setQueryDefaults(queryKeys.all.channel, {
    staleTime: 1000 * 10, // 10 seconds
  });
  queryClient.setQueryDefaults(queryKeys.all.dss, {
    staleTime: 1000 * 5, // 5 seconds
  });
  queryClient.setQueryDefaults(queryKeys.all.email, {
    staleTime: 1000, // 1 second
  });

  return (
    <QueryClientProvider client={queryClient}>
      {props.children}
    </QueryClientProvider>
  );
}
