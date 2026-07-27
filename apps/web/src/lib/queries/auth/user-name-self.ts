import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { authServiceClient } from '@service-auth/client';
import type { UserName } from '@service-auth/generated/schemas/userName';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { authKeys } from './keys';

const OWN_USER_NAME_STALE_TIME = 15_000;

/**
 * The current user's own editable first/last name — the fields Account
 * settings reads and writes via getUserName/putUserName. Distinct from
 * userInfo().name (the legacy identity-provider display name) and from
 * useUserNamesQuery (other users, batched by macro id).
 */
export function useOwnUserNameQuery() {
  return useQuery(() => ({
    queryKey: authKeys.userNameSelf.queryKey,
    queryFn: async () =>
      throwOnErr(async () => await authServiceClient.getUserName()),
    staleTime: OWN_USER_NAME_STALE_TIME,
    refetchOnWindowFocus: 'always' as const,
  }));
}

/**
 * The user's own name, or undefined until it loads. Prefer this over reading
 * `useOwnUserNameQuery().data` directly: that read suspends the nearest
 * boundary while the query is pending, and can re-suspend after an error
 * (solid-query only takes its non-suspending `.latest` path once `data` is
 * defined). Gating on `isSuccess` — not `isPending`, which is false in the
 * error state — is what makes it safe to call during render.
 *
 * Use `useOwnUserNameQuery` directly only when you need status/error/refetch.
 */
export function useOwnUserName(): Accessor<UserName | undefined> {
  const query = useOwnUserNameQuery();
  return () => (query.isSuccess ? query.data : undefined);
}

/**
 * Call after writing the name (putUserName). The write and every reader live
 * in the same tab, so invalidating here is what flips dependent surfaces —
 * e.g. the Getting Started checklist beside a settings Viewer, which would
 * otherwise have to poll.
 */
export function invalidateOwnUserName() {
  return queryClient.invalidateQueries({
    queryKey: authKeys.userNameSelf.queryKey,
  });
}

/**
 * Whether a stored name part is a real value: non-empty and not the 'N/A'
 * placeholder auth-service uses for unset names (the sidebar filters the
 * same way).
 */
export function isRealNamePart(part: string | null | undefined): boolean {
  const trimmed = part?.trim();
  return Boolean(trimmed) && trimmed !== 'N/A';
}
