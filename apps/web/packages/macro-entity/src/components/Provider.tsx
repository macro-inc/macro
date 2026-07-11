import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import type { ParentProps } from 'solid-js';
import { fetchApiToken } from '../queries/auth';
import { queryKeys } from '../queries/key';

export function Provider(props: ParentProps) {
  queryClient.setQueryDefaults(queryKeys.all.auth, {
    staleTime: 1000 * 60 * 55, // 55 minutes
    gcTime: 1000 * 60 * 60 * 24, // 1 day
  });
  queryClient.setQueryDefaults(queryKeys.auth.apiToken, {
    staleTime: 1000 * 60 * 55, // 55 minutes
    queryFn: fetchApiToken,
  });

  return (
    <QueryClientProvider client={queryClient}>
      {props.children}
      {/* <Show when={LOCAL_ONLY}>
        <SolidQueryDevtools initialIsOpen={false} />
      </Show> */}
    </QueryClientProvider>
  );
}
