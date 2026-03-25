import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import {
  isOk,
  mapOk,
  type ObjectLike,
  ok,
  resultError,
} from '@core/util/maybeResult';
import { registerClient } from '@core/util/mockClient';
import { type SafeFetchInit, safeFetch } from '@core/util/safeFetch';
import { logger } from '@observability';
import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';
import { fetchWithAuth as _fetchWithAuth } from './fetch';
import type { PatchUserTutorialRequest, UserQuota } from './generated/schemas';
import type { AppleLoginRequest } from './generated/schemas/appleLoginRequest';
import type { EmptyResponse } from './generated/schemas/emptyResponse';
import type { GenericSuccessResponse } from './generated/schemas/genericSuccessResponse';
import type { GetLegacyUserPermissionsResponse } from './generated/schemas/getLegacyUserPermissionsResponse';
import type { GetProfilePicturesRequestBody } from './generated/schemas/getProfilePicturesRequestBody';
import type { GetUserInfo } from './generated/schemas/getUserInfo';
import type { MacroApiTokenResponse } from './generated/schemas/macroApiTokenResponse';
import type { PasswordRequest } from './generated/schemas/passwordRequest';
import type { PatchUserGroupRequest } from './generated/schemas/patchUserGroupRequest';
import type { PatchUserOnboardingRequest } from './generated/schemas/patchUserOnboardingRequest';
import type { PostGetNamesRequestBody } from './generated/schemas/postGetNamesRequestBody';
import type { ProfilePictures } from './generated/schemas/profilePictures';
import type { PutProfilePictureParams } from './generated/schemas/putProfilePictureParams';
import type { PutUserNameQueryParams } from './generated/schemas/putUserNameQueryParams';
import type { UserLinkResponse } from './generated/schemas/userLinkResponse';
import type { UserName } from './generated/schemas/userName';
import type { UserNames } from './generated/schemas/userNames';
import type { UserOrganizationResponse } from './generated/schemas/userOrganizationResponse';
import type { UserTokensResponse } from './generated/schemas/userTokensResponse';

const authHost = SERVER_HOSTS['auth-service'];

const authApiFetch = <T extends ObjectLike>(
  input: string,
  init?: SafeFetchInit
) =>
  safeFetch<T>(`${authHost}${input}`, {
    ...init,
    credentials: 'include',
  });

const fetchWithAuth = ENABLE_BEARER_TOKEN_AUTH
  ? (_fetchWithAuth as typeof fetchWithToken)
  : fetchWithToken;

type Token = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};
const [accessTokenData, setAccessTokenData] = makePersisted(
  createSignal<Token | null>(null),
  {
    name: 'macroAccessToken',
  }
);

function getExpiresAt(token: string) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp;
  } catch {
    return 0;
  }
}

// Promise to track ongoing refresh operations to prevent multiple concurrent refreshes
let ongoingRefresh: Promise<string | null> | null = null;
export async function getAccessToken(): Promise<string | null> {
  const data = accessTokenData();
  if (!data) {
    return null;
  }

  const { accessToken, refreshToken, expiresAt } = data;
  if (expiresAt < Date.now()) {
    // If there's already an ongoing refresh, wait for it to complete
    if (ongoingRefresh) {
      return await ongoingRefresh;
    }

    // Start a new refresh operation
    ongoingRefresh = (async () => {
      try {
        const result = await authServiceClient.refreshToken({
          accessToken,
          refreshToken,
        });

        if (isOk(result)) {
          // After successful refresh, get the updated access token from storage
          setAccessTokenData({
            accessToken: result[1].access_token,
            refreshToken: result[1].refresh_token,
            expiresAt: getExpiresAt(result[1].access_token),
          });
          return result[1].access_token;
        } else {
          // Refresh failed
          return null;
        }
      } catch (error) {
        logger.error('Error refreshing access token', { error });
        return null;
      } finally {
        // Clear the ongoing refresh promise so future calls can start a new refresh
        ongoingRefresh = null;
      }
    })();

    return await ongoingRefresh;
  }

  return accessToken;
}

export type { GetLegacyUserPermissionsResponse, UserOrganizationResponse };

export const authServiceClient = {
  async logout() {
    setAccessTokenData(null);
    return mapOk(
      await authApiFetch<EmptyResponse>(`/logout`, { method: 'POST' }),
      (result) => result
    );
  },
  async getUserInfo() {
    return mapOk(
      await fetchWithAuth<Partial<GetUserInfo>>(`${authHost}/user/me`, {
        method: 'GET',
      }),
      (data) => ({
        authenticated: !!data.user_id,
        permissions: data.permissions || [],
        userId: data.user_id,
        organizationId: data.organization_id ?? undefined,
      })
    );
  },
  async sessionLogin(args: { session_code: string }) {
    const maybeResult = await authApiFetch<UserTokensResponse>(
      `/session/login/${args.session_code}`
    );
    if (isOk(maybeResult)) {
      setAccessTokenData({
        accessToken: maybeResult[1].access_token,
        refreshToken: maybeResult[1].refresh_token,
        expiresAt: getExpiresAt(maybeResult[1].access_token),
      });
    }
    return maybeResult;
  },
  async deleteUser() {
    setAccessTokenData(null);
    return fetchWithAuth<GenericSuccessResponse>(`${authHost}/user/me`, {
      method: 'DELETE',
    });
  },
  async appleLogin(args: AppleLoginRequest) {
    return authApiFetch<EmptyResponse>(`/login/apple`, {
      method: 'POST',
      body: JSON.stringify(args),
    });
  },
  async passwordLogin(args: PasswordRequest) {
    return authApiFetch<UserTokensResponse>(`/login/password`, {
      method: 'POST',
      body: JSON.stringify(args),
    });
  },
  async passwordlessCallback({ code, email }: { code: string; email: string }) {
    const maybeResult = await safeFetch<UserTokensResponse>(
      `${authHost}/oauth/passwordless/${code}?email=${encodeURIComponent(email)}&disable_redirect=true`,
      { cache: 'no-store', credentials: 'include' },
      async (response) => {
        const message = await response.text();
        return resultError({ code: 'UNAUTHORIZED', message });
      }
    );
    if (isOk(maybeResult)) {
      setAccessTokenData({
        accessToken: maybeResult[1].access_token,
        refreshToken: maybeResult[1].refresh_token,
        expiresAt: getExpiresAt(maybeResult[1].access_token),
      });
    }
    return maybeResult;
  },
  async refreshToken(args: { accessToken: string; refreshToken: string }) {
    return authApiFetch<UserTokensResponse>('/jwt/refresh', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        'x-macro-refresh-token': args.refreshToken,
      },
    });
  },
  async postProfilePictures(
    args: GetProfilePicturesRequestBody,
    init?: SafeFetchInit
  ) {
    return mapOk(
      await fetchWithAuth<ProfilePictures>(
        `${authHost}/user/profile_pictures`,
        {
          ...init,
          method: 'POST',
          body: JSON.stringify(args),
        }
      ),
      (result) => result
    );
  },
  async putProfilePicture(args: PutProfilePictureParams) {
    return mapOk(
      await fetchWithAuth<ProfilePictures>(
        `${authHost}/user/profile_picture?url=${args.url}`,
        {
          method: 'PUT',
        }
      ),
      (result) => result
    );
  },
  async getUserName() {
    return mapOk(
      await fetchWithAuth<UserName>(`${authHost}/user/name`, {
        method: 'GET',
      }),
      (result) => result
    );
  },
  async putUserName(args: PutUserNameQueryParams) {
    const queryParams: string[] = [];

    if (args.first_name !== undefined && args.first_name !== null) {
      queryParams.push(`first_name=${encodeURIComponent(args.first_name)}`);
    }

    if (args.last_name !== undefined && args.last_name !== null) {
      queryParams.push(`last_name=${encodeURIComponent(args.last_name)}`);
    }
    const queryString = queryParams.join('&');
    return mapOk(
      await fetchWithAuth<UserName>(`${authHost}/user/name?${queryString}`, {
        method: 'PUT',
      }),
      (result) => result
    );
  },
  async getUserNames(args: PostGetNamesRequestBody) {
    return mapOk(
      await fetchWithAuth<UserNames>(`${authHost}/user/get_names`, {
        method: 'POST',
        body: JSON.stringify(args),
      }),
      (result) => result
    );
  },
  async getUserNamesWithEmail(args: PostGetNamesRequestBody) {
    return mapOk(
      await fetchWithAuth<UserNames>(`${authHost}/user/get_names_with_email`, {
        method: 'POST',
        body: JSON.stringify(args),
      }),
      (result) => result
    );
  },
  async checkLinkExists(args: { idp_name?: string; idp_id?: string }) {
    const queryParams: string[] = [];
    if (args.idp_name !== undefined && args.idp_name !== null) {
      queryParams.push(`idp_name=${args.idp_name}`);
    }

    if (args.idp_id !== undefined && args.idp_id !== null) {
      queryParams.push(`idp_id=${args.idp_id}`);
    }
    const queryString = queryParams.join('&');
    return mapOk(
      await fetchWithAuth<UserLinkResponse>(
        `${authHost}/user/link_exists?${queryString}`,
        {
          method: 'GET',
        }
      ),
      (result) => result
    );
  },
  async macroApiToken() {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      logger.warn('No access token found, fetching with cookies');
      return authApiFetch<MacroApiTokenResponse>('/jwt/macro_api_token');
    }

    return await authApiFetch<MacroApiTokenResponse>('/jwt/macro_api_token', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  },
  async userQuota() {
    const result = await mapOk(
      await fetchWithAuth<UserQuota>(`${authHost}/user/quota`, {
        method: 'GET',
      }),
      (result) => result
    );

    return result;
  },
  async patchUserTutorial(args: PatchUserTutorialRequest) {
    return mapOk(
      await fetchWithAuth<EmptyResponse>(`${authHost}/user/tutorial`, {
        method: 'PATCH',
        body: JSON.stringify(args),
      }),
      (result) => result
    );
  },

  async patchAiConsent(args: { aiDataConsent: boolean }) {
    return mapOk(
      await fetchWithAuth<EmptyResponse>(`${authHost}/user/ai_consent`, {
        method: 'PATCH',
        body: JSON.stringify(args),
      }),
      (result) => result
    );
  },

  // HTTP methods (migrated from RPC)
  async getLegacyUserPermissions() {
    const result = await fetchWithAuth<GetLegacyUserPermissionsResponse>(
      `${authHost}/user/legacy_user_permissions`,
      { method: 'GET' }
    );

    return mapOk(result, (data) => ({
      id: data.userId,
      permissions: data.permissions,
      email: data.email,
      name: data.name,
      licenseStatus: data.licenseStatus,
      tutorialComplete: data.tutorialComplete,
      group: data.group,
      hasChromeExt: data.hasChromeExt,
      authenticated: !!data.userId,
      userId: data.userId,
      hasTrialed: data.hasTrialed,
      aiDataConsent: data.aiDataConsent,
      referralCode: data.referralCode,
    }));
  },

  async getOrganization() {
    const response = await fetchWithAuth<UserOrganizationResponse>(
      `${authHost}/user/organization`,
      { method: 'GET' }
    );

    // If the response is an error, treat as no organization (204 No Content or other errors)
    if (!isOk(response)) {
      return ok({
        organizationId: undefined as string | undefined,
        organizationName: undefined as string | undefined,
      });
    }

    return ok({
      organizationId: response[1].organizationId
        ? String(response[1].organizationId)
        : undefined,
      organizationName: response[1].organizationName as string | undefined,
    });
  },

  async completeOnboarding(args: PatchUserOnboardingRequest) {
    return mapOk(
      await fetchWithAuth<EmptyResponse>(`${authHost}/user/onboarding`, {
        method: 'PATCH',
        body: JSON.stringify(args),
      }),
      () => undefined
    );
  },

  async setGroup(args: PatchUserGroupRequest) {
    return mapOk(
      await fetchWithAuth<EmptyResponse>(`${authHost}/user/group`, {
        method: 'PATCH',
        body: JSON.stringify(args),
      }),
      () => undefined
    );
  },

  // Stripe HTTP methods (replacing RPC calls)
  async createCheckoutSession(args: {
    successUrl: string;
    cancelUrl: string;
    discount?: string | null;
    gaClientId?: string | null;
    tier?: string;
  }) {
    return mapOk(
      await fetchWithAuth<{ url: string }>(`${authHost}/user/stripe/checkout`, {
        method: 'POST',
        body: JSON.stringify({
          successUrl: args.successUrl,
          cancelUrl: args.cancelUrl,
          discount: args.discount ?? undefined,
          gaClientId: args.gaClientId ?? undefined,
          tier: args.tier ?? undefined,
        }),
      }),
      (result) => result.url
    );
  },

  async createPortalSession(args: { returnUrl: string }) {
    return mapOk(
      await fetchWithAuth<{ url: string }>(`${authHost}/user/stripe/portal`, {
        method: 'POST',
        body: JSON.stringify({
          returnUrl: args.returnUrl,
        }),
      }),
      (result) => result.url
    );
  },
};

registerClient('auth', authServiceClient);
