/**
 * Sidebar prompts the user dismissed, stored server-side so a dismissal holds
 * on every device. Dismissing updates the cache optimistically; a failed
 * write refetches the server's answer.
 */
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  type DismissedPrompts,
  promptDismissalsClient,
} from '@service-cognition/prompt-dismissals';
import { useQuery } from '@tanstack/solid-query';

const KEY = ['promptDismissals'] as const;

function fetchDismissedPrompts() {
  return throwOnErr(() => promptDismissalsClient.list());
}

function promptDismissalsQueryOptions() {
  return {
    queryKey: KEY,
    queryFn: fetchDismissedPrompts,
    staleTime: 5 * 60 * 1000,
  };
}

export function usePromptDismissalsQuery() {
  return useQuery(promptDismissalsQueryOptions);
}

/** Dismiss `promptId` on every device. */
export function dismissPromptEverywhere(promptId: string): void {
  queryClient.setQueryData(KEY, (current: DismissedPrompts | undefined) =>
    current?.dismissed.includes(promptId)
      ? current
      : { dismissed: [...(current?.dismissed ?? []), promptId] }
  );
  void promptDismissalsClient.dismiss(promptId).then((result) => {
    if (result.isErr()) void queryClient.invalidateQueries({ queryKey: KEY });
  });
}
