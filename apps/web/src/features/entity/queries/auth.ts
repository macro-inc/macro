/** Authentication queries used by the entity feature. */
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { thrownResultErrorHasCode } from '@core/util/result';
import { queryClient } from '@queries/client';
import type { MacroApiTokenResponse } from '@service-auth/generated/schemas/macroApiTokenResponse';
import {
  queryOptions,
  type SolidQueryOptions,
  useQuery,
} from '@tanstack/solid-query';
import { queryKeys } from './key';

const authHost = SERVER_HOSTS['auth-service'];

/** The API token was rejected: the service client preserved the 401 as a
 * result error carrying the UNAUTHORIZED code. */
function isApiTokenRejected(error: unknown): boolean {
  return thrownResultErrorHasCode(error, 'UNAUTHORIZED');
}

/** A freshly minted token that the service still rejected. Retrying with it
 * again cannot help, so no further mint happens until the cache holds a
 * different token. Bounds a persistent 401 to one extra request per token. */
let rejectedFreshToken: string | undefined;

/**
 * Runs `fetchFn` with the cached API token and, on a 401, mints a new token
 * once and retries. Reads the token from the query cache so it can live inside
 * cached query callbacks without retaining an observer. The original rejection
 * is what surfaces if the mint or the retry fails, so callers keep the
 * UNAUTHORIZED code the app-wide retry policy keys on.
 */
export async function withCachedApiTokenRetry<T>(
  fetchFn: (apiToken: string) => Promise<T>
): Promise<T> {
  const apiToken = queryClient.getQueryData<string>(
    createApiTokenQueryOptions().queryKey
  );
  if (!apiToken) throw new Error('No API token available');

  try {
    return await fetchFn(apiToken);
  } catch (error) {
    if (!isApiTokenRejected(error) || apiToken === rejectedFreshToken) {
      throw error;
    }

    let refreshed: string;
    try {
      refreshed = await queryClient.fetchQuery({
        ...createApiTokenQueryOptions(),
        staleTime: 0,
      });
    } catch {
      throw error;
    }

    try {
      return await fetchFn(refreshed);
    } catch (retryError) {
      if (isApiTokenRejected(retryError)) rejectedFreshToken = refreshed;
      throw retryError;
    }
  }
}

export const fetchApiToken = async () => {
  const result = await fetchWithToken<MacroApiTokenResponse>(
    `${authHost}/jwt/macro_api_token`
  );

  if (!result.isOk()) {
    throw new Error('Failed to fetch API token', { cause: result.error });
  }

  return result.value.macro_api_token;
};

type ApiTokenQueryOptions = SolidQueryOptions<
  string,
  Error,
  string,
  string[]
> & {
  initialData?: undefined;
};
function createApiTokenQueryOptions(): ApiTokenQueryOptions {
  return queryOptions({
    queryKey: queryKeys.auth.apiToken,
    queryFn: fetchApiToken,
  });
}

export function createApiTokenQuery() {
  return useQuery(() => createApiTokenQueryOptions());
}
