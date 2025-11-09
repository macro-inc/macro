import {
  queryOptions,
  type SolidQueryOptions,
  useQuery,
} from '@tanstack/solid-query';
import { SERVER_HOSTS } from 'core/constant/servers';
import { platformFetch } from 'core/util/platformFetch';
import type { MacroApiTokenResponse } from 'service-auth/generated/schemas/macroApiTokenResponse';
import type { ProfilePictures } from 'service-auth/generated/schemas/profilePictures';
import { createMemo } from 'solid-js';
import { queryKeys } from './key';

const authHost = SERVER_HOSTS['auth-service'];

export const fetchApiToken = async () => {
  const response = await platformFetch(`${authHost}/jwt/macro_api_token`, {
    credentials: 'include',
  });
  if (!response.ok)
    throw new Error('Failed to fetch API token', { cause: response });

  const { macro_api_token }: MacroApiTokenResponse = await response.json();
  return macro_api_token;
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
  if (!response.ok)
    throw new Error('Failed to fetch profile picture', { cause: response });

  const { pictures }: ProfilePictures = await response.json();
  if (pictures.length === 0)
    throw new Error(`No profile picture found for ${user_id_list}`);

  return pictures;
};

export function createProfilePictureQuery(id: string) {
  const authQuery = createApiTokenQuery();
  return useQuery(() => ({
    queryKey: queryKeys.auth.profilePicture({ id }),
    queryFn: () => fetchProfilePictures([id], authQuery.data),
    select: (pictures) => pictures.at(0),
    enabled: authQuery.isSuccess,
    retry: 1,
    retryOnMount: false,
  }));
}
