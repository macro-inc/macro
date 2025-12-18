import { queryClient as _queryClient } from '@queries/client';

export const queryClient = _queryClient;

export function useQueryClient() {
  return queryClient;
}
