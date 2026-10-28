/**
 * Sidebar prompts the user dismissed, stored server-side so a dismissal holds
 * on every device. Dismissing updates the cache optimistically; a failed
 * write refetches the server's answer.
 */
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import {
  type DismissedPrompts,
  promptDismissalsClient,
} from '@service-cognition/prompt-dismissals';
import { useQuery } from '@tanstack/solid-query';
import { type Accessor, createEffect, on } from 'solid-js';

const KEY = ['promptDismissals'] as const;

function fetchDismissedPrompts() {
  return throwOnErr(() => promptDismissalsClient.list());
}

function promptDismissalsQueryOptions() {
  return {
    queryKey: KEY,
    queryFn: fetchDismissedPrompts,
    staleTime: 5 * 60 * 1000,
    // Cards fall back to what the browser remembers when the list is
    // unavailable, so a retry would only hold them back.
    retry: false,
  };
}

/**
 * The list as a card reads it. The app-level observer below loads it, so a
 * card mounting never refetches: an answer, or a failure that falls back to
 * the browser's own record, is available at once.
 */
export function usePromptDismissalsQuery() {
  return useQuery(() => ({
    ...promptDismissalsQueryOptions(),
    refetchOnMount: false,
    retryOnMount: false,
  }));
}

/**
 * Loads the list once the user is known and keeps it cached for the session,
 * so a sidebar card never waits on it when its view opens.
 */
export function useWarmPromptDismissals(userId: Accessor<string | undefined>) {
  // The shared cache is the external system here; nothing renders from it.
  createEffect(
    on(userId, (id) => {
      if (id) queryClient.prefetchQuery(promptDismissalsQueryOptions());
    })
  );
}

/** Dismiss `promptId` on every device. */
export function dismissPromptEverywhere(promptId: string): void {
  queryClient.setQueryData(KEY, (current: DismissedPrompts | undefined) =>
    current?.dismissed.includes(promptId)
      ? current
      : { dismissed: [...(current?.dismissed ?? []), promptId] }
  );
  fireAndForget(saveDismissal(promptId), 'prompt-dismissals.dismiss');
}

/** A failed write refetches the server's answer instead of keeping the guess. */
async function saveDismissal(promptId: string) {
  const result = await promptDismissalsClient.dismiss(promptId);
  if (result.isErr()) queryClient.invalidateQueries({ queryKey: KEY });
}
