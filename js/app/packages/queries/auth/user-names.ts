import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import type { UserName } from '@service-auth/generated/schemas/userName';
import { useQueries } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { authKeys } from './keys';

const USER_NAMES_STALE_TIME = 10 * 60 * 1000;
const MACRO_ID_PREFIX = 'macro|';

type UseUserNamesQueryOptions = {
  userIds: Accessor<readonly string[]>;
  enabled?: Accessor<boolean>;
};

type PendingUserNameRequest = {
  resolve: (userName: UserName | null) => void;
  reject: (error: unknown) => void;
};

let pendingUserNameRequests = new Map<string, PendingUserNameRequest[]>();
let pendingUserNameFlush: ReturnType<typeof setTimeout> | undefined;

export function normalizeUserNameQueryId(userId: string): string {
  const trimmed = userId.trim();
  return isMacroUserNameQueryId(trimmed) ? trimmed.toLowerCase() : trimmed;
}

function uniqueUserNameQueryIds(userIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const queryUserIds: string[] = [];

  for (const userId of userIds) {
    const queryUserId = normalizeUserNameQueryId(userId);
    if (!queryUserId || seen.has(queryUserId)) continue;
    seen.add(queryUserId);
    queryUserIds.push(queryUserId);
  }

  return queryUserIds;
}

function isMacroUserNameQueryId(userId: string): boolean {
  const trimmed = userId.trim().toLowerCase();
  return (
    trimmed.startsWith(MACRO_ID_PREFIX) &&
    trimmed.slice(MACRO_ID_PREFIX.length).includes('@')
  );
}

async function fetchUserNames(userIds: string[]): Promise<UserName[]> {
  const macroUserIds = userIds.filter(isMacroUserNameQueryId);
  if (macroUserIds.length === 0) return [];

  const result = await throwOnErr(
    async () =>
      await authServiceClient.getUserNamesWithEmail({
        user_ids: macroUserIds,
      })
  );

  return result.names;
}

function flushPendingUserNameRequests() {
  const requestsById = pendingUserNameRequests;
  pendingUserNameRequests = new Map();
  pendingUserNameFlush = undefined;

  const userIds = Array.from(requestsById.keys());
  fetchUserNames(userIds)
    .then((names) => {
      const namesById = new Map(
        names.map((name) => [normalizeUserNameQueryId(name.id), name])
      );

      for (const [userId, requests] of requestsById) {
        const userName = namesById.get(userId) ?? null;
        for (const request of requests) request.resolve(userName);
      }
    })
    .catch((error) => {
      for (const requests of requestsById.values()) {
        for (const request of requests) request.reject(error);
      }
    });
}

async function fetchUserName(userId: string): Promise<UserName | null> {
  return new Promise((resolve, reject) => {
    const requests = pendingUserNameRequests.get(userId) ?? [];
    requests.push({ resolve, reject });
    pendingUserNameRequests.set(userId, requests);

    if (pendingUserNameFlush) return;
    pendingUserNameFlush = setTimeout(flushPendingUserNameRequests, 0);
  });
}

export function userNameQueryOptions(userId: string) {
  const queryUserId = normalizeUserNameQueryId(userId);
  return {
    queryKey: authKeys.userName(queryUserId).queryKey,
    queryFn: () => fetchUserName(queryUserId),
    enabled: Boolean(queryUserId),
    throwOnError: false,
    staleTime: USER_NAMES_STALE_TIME,
  };
}

export function useUserNamesQuery(options: UseUserNamesQueryOptions) {
  return useQueries(() => {
    const enabled = options.enabled?.() ?? true;
    return {
      queries: uniqueUserNameQueryIds(options.userIds()).map((userId) => {
        const queryOptions = userNameQueryOptions(userId);
        return {
          ...queryOptions,
          enabled: enabled && queryOptions.enabled,
        };
      }),
    };
  });
}
