import type { MacroApiTokenResponse } from '@service-auth/generated/schemas/macroApiTokenResponse';
import type { ProfilePictures } from '@service-auth/generated/schemas/profilePictures';
import {
  queryOptions,
  type SolidQueryOptions,
  useQuery,
} from '@tanstack/solid-query';
import { SERVER_HOSTS } from 'core/constant/servers';
import { fetchWithToken } from 'core/util/fetchWithToken';
import { isOk } from 'core/util/maybeResult';
import { platformFetch } from 'core/util/platformFetch';
import { createMemo } from 'solid-js';
import { queryKeys } from './key';

const authHost = SERVER_HOSTS['auth-service'];

export class FetchDocumentsError extends Error {
  constructor(
    message: string,
    public readonly response: Response,
    public readonly data?: { message?: string }
  ) {
    super(message);
    this.name = 'FetchDocumentsError';
  }

  isJwtExpired(): boolean {
    return this.response.status === 401 && this.data?.message === 'jwt expired';
  }
}

export async function handleFetchResponse(
  response: Response,
  errorMessage: string
): Promise<void> {
  if (!response.ok) {
    const errorData =
      response.status === 401
        ? await response.json().catch(() => undefined)
        : undefined;
    throw new FetchDocumentsError(errorMessage, response, errorData);
  }
}

export async function withApiTokenRetry<T>(
  authQuery: ReturnType<typeof createApiTokenQuery>,
  fetchFn: (apiToken: string) => Promise<T>
): Promise<T> {
  if (!authQuery.data) throw new Error('No API token available');

  try {
    return await fetchFn(authQuery.data);
  } catch (error) {
    if (error instanceof FetchDocumentsError && error.isJwtExpired()) {
      const refetchResult = await authQuery.refetch();
      if (refetchResult.isSuccess) {
        return await fetchFn(refetchResult.data);
      }
    }
    throw error;
  }
}

export const fetchApiToken = async () => {
  const result = await fetchWithToken<MacroApiTokenResponse>(
    `${authHost}/jwt/macro_api_token`
  );

  if (!isOk(result)) {
    throw new Error('Failed to fetch API token', { cause: result[0] });
  }

  return result[1].macro_api_token;
};

type ApiTokenQueryOptions = SolidQueryOptions<
  string,
  Error,
  string,
  string[]
> & {
  initialData?: undefined;
};
export function createApiTokenQueryOptions(): ApiTokenQueryOptions {
  return queryOptions({
    queryKey: queryKeys.auth.apiToken,
    queryFn: fetchApiToken,
  });
}

export function createApiTokenQuery() {
  return useQuery(() => createApiTokenQueryOptions());
}

export function useUserId() {
  const authQuery = createApiTokenQuery();
  return createMemo<string | undefined>(() => {
    if (!authQuery.isSuccess) return;

    const token = authQuery.data;
    if (!token) return;

    const parts = token.split('.');
    if (parts.length !== 3) return;
    try {
      const payload = parts[1];
      if (!payload) return;

      const parsedPayload = JSON.parse(
        atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
      );

      return parsedPayload.macro_user_id;
    } catch {
      return;
    }
  });
}

const fetchProfilePictures = async (
  user_id_list: Array<string>,
  apiToken?: string
) => {
  const credentials: RequestInit = apiToken
    ? {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      }
    : {
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      };
  const response = await platformFetch(`${authHost}/user/profile_pictures`, {
    method: 'POST',
    body: JSON.stringify({ user_id_list }),
    ...credentials,
  });

  await handleFetchResponse(response, 'Failed to fetch profile picture');

  const { pictures }: ProfilePictures = await response.json();
  if (pictures.length === 0)
    throw new Error(`No profile picture found for ${user_id_list}`);

  return pictures;
};

export function createProfilePictureQuery(id: string) {
  const authQuery = createApiTokenQuery();
  return useQuery(() => ({
    queryKey: queryKeys.auth.profilePicture({ id }),
    queryFn: () =>
      withApiTokenRetry(authQuery, (apiToken) =>
        fetchProfilePictures([id], apiToken)
      ),
    select: (pictures) => pictures.at(0),
    enabled: authQuery.isSuccess,
    retry: 1,
    retryOnMount: false,
  }));
}
