import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { registerClient } from '@core/util/mockClient';
import type { ObjectLike } from '@core/util/result';
import {
  type ErrorResponseHandler,
  type SafeFetchInit,
  safeFetch,
} from '@core/util/safeFetch';
import { Telemetry } from '@macro-inc/observability';

import { makePersisted } from '@solid-primitives/storage';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { fetchWithAuth as _fetchWithAuth } from './fetch';
import type {
  CursorApiKeyStatus,
  CursorModelsResponse,
  EnrichGithubPullRequestsProxyRequest,
  EnrichGithubPullRequestsResponse,
  GithubLinkStatusResponse,
  GmailLinkStatusResponse,
  InitGithubLinkResponse,
  InitGmailLinkResponse,
  PatchUserTutorialRequest,
  SendMobileWelcomeEmailResponse,
  UserQuota,
} from './generated/schemas';
import type { AppleLoginRequest } from './generated/schemas/appleLoginRequest';
import type { CreateTeamRequest } from './generated/schemas/createTeamRequest';
import type { EmptyResponse } from './generated/schemas/emptyResponse';
import type { GenericSuccessResponse } from './generated/schemas/genericSuccessResponse';
import type { GetLegacyUserPermissionsResponse } from './generated/schemas/getLegacyUserPermissionsResponse';
import type { GetProfilePicturesRequestBody } from './generated/schemas/getProfilePicturesRequestBody';
import type { GetUserInfo } from './generated/schemas/getUserInfo';
import type { InviteToTeamRequest } from './generated/schemas/inviteToTeamRequest';
import type { MacroApiTokenResponse } from './generated/schemas/macroApiTokenResponse';
import type { PasswordRequest } from './generated/schemas/passwordRequest';
import type { PatchTeamRequest } from './generated/schemas/patchTeamRequest';
import type { PatchUserGroupRequest } from './generated/schemas/patchUserGroupRequest';
import type { PatchUserOnboardingRequest } from './generated/schemas/patchUserOnboardingRequest';
import type { PostGetNamesRequestBody } from './generated/schemas/postGetNamesRequestBody';
import type { ProfilePictures } from './generated/schemas/profilePictures';
import type { PutProfilePictureParams } from './generated/schemas/putProfilePictureParams';
import type { PutUserNameQueryParams } from './generated/schemas/putUserNameQueryParams';
import type { Team } from './generated/schemas/team';
import type { TeamInvitesResponse } from './generated/schemas/teamInvitesResponse';
import type { TeamWithMembers } from './generated/schemas/teamWithMembers';
import type { ToggleAutoJoinDomainResponse } from './generated/schemas/toggleAutoJoinDomainResponse';
import type { ToggleNonAdminInvitesResponse } from './generated/schemas/toggleNonAdminInvitesResponse';
import type { UserLinkResponse } from './generated/schemas/userLinkResponse';
import type { UserName } from './generated/schemas/userName';
import type { UserNames } from './generated/schemas/userNames';
import type { UserOrganizationResponse } from './generated/schemas/userOrganizationResponse';
import type { UserTokensResponse } from './generated/schemas/userTokensResponse';

const authHost = SERVER_HOSTS['auth-service'];

/**
 * Which permissions a Google consent screen asks for. `calendar` covers an
 * inbox that is already connected, so the screen lists calendar access alone.
 */
export type ConsentScopes = 'gmail' | 'gmail_and_calendar' | 'calendar';

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
async function getAccessToken(): Promise<string | null> {
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

        if (result.isOk()) {
          // After successful refresh, get the updated access token from storage
          setAccessTokenData({
            accessToken: result.value.access_token,
            refreshToken: result.value.refresh_token,
            expiresAt: getExpiresAt(result.value.access_token),
          });
          return result.value.access_token;
        } else {
          // Refresh failed
          return null;
        }
      } catch (error) {
        Telemetry.error('Error refreshing access token', {
          error: error instanceof Error ? error.message : String(error),
        });
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

export type GithubReauthenticationErrorCode = 'REAUTHENTICATION_REQUIRED';

/** The team owner's email domain is a generic provider (e.g. gmail.com),
 *  so auto-join cannot be enabled for it. */
export type ToggleAutoJoinDomainErrorCode = 'GENERIC_DOMAIN_NOT_ALLOWED';

/**
 * Surfaces the Cursor API key endpoints' own error message instead of a generic
 * one derived from the status code.
 *
 * These endpoints answer with a body that already says what went wrong and is
 * written to be safe to show a user — "value does not look like a Cursor API
 * key", "Cursor agents are only available to Macro staff". The default handler
 * throws that away and reports `HTTP error! status: 403`, which tells the user
 * nothing they can act on.
 */
const cursorApiKeyErrorResponseHandler: ErrorResponseHandler<'CURSOR_API_KEY_ERROR'> =
  async function handleCursorApiKeyErrorResponse(response) {
    // Falls back to the status when the body is not the shape we expect: a
    // failure to parse an error must not replace the error.
    const message = await response
      .json()
      .then((body: unknown) =>
        typeof body === 'object' && body !== null && 'message' in body
          ? String((body as { message: unknown }).message)
          : undefined
      )
      .catch(() => undefined);

    return {
      code: 'CURSOR_API_KEY_ERROR',
      message: message ?? `HTTP error! status: ${response.status}`,
    };
  };

const githubErrorResponseHandler: ErrorResponseHandler<GithubReauthenticationErrorCode> =
  async function handleGithubErrorResponse(response) {
    switch (response.status) {
      case 428:
        return {
          code: 'REAUTHENTICATION_REQUIRED',
          message: 'GitHub reauthentication required',
        };
      case 401:
        return { code: 'UNAUTHORIZED', message: 'Unauthorized access' };
      case 403:
        return { code: 'FORBIDDEN', message: 'Forbidden' };
      case 404:
        return { code: 'NOT_FOUND', message: 'Resource not found' };
      case 409:
        return { code: 'CONFLICT', message: 'Resource conflict' };
      case 410:
        return { code: 'GONE', message: 'Resource deleted' };
      case 500:
        return { code: 'SERVER_ERROR', message: 'Internal server error' };
      default:
        return {
          code: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
        };
    }
  };

export const authServiceClient = {
  async logout() {
    setAccessTokenData(null);
    return (
      await authApiFetch<EmptyResponse>(`/logout`, { method: 'POST' })
    ).map((result) => result);
  },
  async getUserInfo() {
    return (
      await fetchWithAuth<Partial<GetUserInfo>>(`${authHost}/user/me`, {
        method: 'GET',
      })
    ).map((data) => ({
      authenticated: !!data.user_id,
      permissions: data.permissions || [],
      userId: data.user_id,
      organizationId: data.organization_id ?? undefined,
    }));
  },
  async sessionLogin(args: { session_code: string }) {
    // The session code stays valid server-side for 5 minutes and is
    // replayable, so retrying transient failures is safe.
    const result = await authApiFetch<UserTokensResponse>(
      `/session/login/${args.session_code}`,
      { retry: { maxTries: 3, delay: 'exponential' } }
    );
    if (result.isOk()) {
      setAccessTokenData({
        accessToken: result.value.access_token,
        refreshToken: result.value.refresh_token,
        expiresAt: getExpiresAt(result.value.access_token),
      });
    }
    return result;
  },
  async deleteUser() {
    const result = await fetchWithAuth<GenericSuccessResponse>(
      `${authHost}/user/me`,
      {
        method: 'DELETE',
      }
    );

    if (result.isOk()) {
      setAccessTokenData(null);
    }

    return result;
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
    const result = await safeFetch<UserTokensResponse>(
      `${authHost}/oauth/passwordless/${code}?email=${encodeURIComponent(email)}&disable_redirect=true`,
      { cache: 'no-store', credentials: 'include' },
      async (response) => {
        const message = await response.text();
        return { code: 'UNAUTHORIZED' as const, message };
      }
    );
    if (result.isOk()) {
      setAccessTokenData({
        accessToken: result.value.access_token,
        refreshToken: result.value.refresh_token,
        expiresAt: getExpiresAt(result.value.access_token),
      });
    }
    return result;
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
    return (
      await fetchWithAuth<ProfilePictures>(
        `${authHost}/user/profile_pictures`,
        {
          ...init,
          method: 'POST',
          body: JSON.stringify(args),
        }
      )
    ).map((result) => result);
  },
  async putProfilePicture(args: PutProfilePictureParams) {
    return (
      await fetchWithAuth<EmptyResponse>(
        `${authHost}/user/profile_picture?url=${encodeURIComponent(args.url)}`,
        {
          method: 'PUT',
        }
      )
    ).map((result) => result);
  },
  async getUserName() {
    return (
      await fetchWithAuth<UserName>(`${authHost}/user/name`, {
        method: 'GET',
      })
    ).map((result) => result);
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
    return (
      await fetchWithAuth<UserName>(`${authHost}/user/name?${queryString}`, {
        method: 'PUT',
      })
    ).map((result) => result);
  },
  async getUserNames(args: PostGetNamesRequestBody) {
    return (
      await fetchWithAuth<UserNames>(`${authHost}/user/get_names`, {
        method: 'POST',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
  },
  async getUserNamesWithEmail(args: PostGetNamesRequestBody) {
    return (
      await fetchWithAuth<UserNames>(`${authHost}/user/get_names_with_email`, {
        method: 'POST',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
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
    return (
      await fetchWithAuth<UserLinkResponse>(
        `${authHost}/user/link_exists?${queryString}`,
        {
          method: 'GET',
        }
      )
    ).map((result) => result);
  },
  async macroApiToken() {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      Telemetry.warn('No access token found, fetching with cookies');
      return authApiFetch<MacroApiTokenResponse>('/jwt/macro_api_token');
    }

    return await authApiFetch<MacroApiTokenResponse>('/jwt/macro_api_token', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  },
  async userQuota() {
    const result = await (
      await fetchWithAuth<UserQuota>(`${authHost}/user/quota`, {
        method: 'GET',
      })
    ).map((result) => result);

    return result;
  },

  async enrichGithubPullRequests(args: EnrichGithubPullRequestsProxyRequest) {
    return (
      await fetchWithAuth<
        EnrichGithubPullRequestsResponse,
        GithubReauthenticationErrorCode
      >(`${authHost}/github_pull_requests/enrich`, {
        method: 'POST',
        body: JSON.stringify(args),
        errorResponseHandler: githubErrorResponseHandler,
      })
    ).map((result) => result);
  },
  async patchUserTutorial(args: PatchUserTutorialRequest) {
    return (
      await fetchWithAuth<EmptyResponse>(`${authHost}/user/tutorial`, {
        method: 'PATCH',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
  },

  async patchAiConsent(args: { aiDataConsent: boolean }) {
    return (
      await fetchWithAuth<EmptyResponse>(`${authHost}/user/ai_consent`, {
        method: 'PATCH',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
  },

  // HTTP methods (migrated from RPC)
  async getLegacyUserPermissions() {
    const result = await fetchWithAuth<GetLegacyUserPermissionsResponse>(
      `${authHost}/user/legacy_user_permissions`,
      { method: 'GET' }
    );

    return result.map((data) => ({
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
      createdAt: data.createdAt,
    }));
  },

  async getOrganization() {
    const response = await fetchWithAuth<UserOrganizationResponse>(
      `${authHost}/user/organization`,
      { method: 'GET' }
    );

    // If the response is an error, treat as no organization (204 No Content or other errors)
    if (!response.isOk()) {
      return ok({
        organizationId: undefined as string | undefined,
        organizationName: undefined as string | undefined,
      });
    }

    return ok({
      organizationId: response.value.organizationId
        ? String(response.value.organizationId)
        : undefined,
      organizationName: response.value.organizationName as string | undefined,
    });
  },

  async completeOnboarding(args: PatchUserOnboardingRequest) {
    return (
      await fetchWithAuth<EmptyResponse>(`${authHost}/user/onboarding`, {
        method: 'PATCH',
        body: JSON.stringify(args),
      })
    ).map(() => undefined);
  },

  async setGroup(args: PatchUserGroupRequest) {
    return (
      await fetchWithAuth<EmptyResponse>(`${authHost}/user/group`, {
        method: 'PATCH',
        body: JSON.stringify(args),
      })
    ).map(() => undefined);
  },

  async sendReferralInvite(recipient: string) {
    return (
      await fetchWithAuth<EmptyResponse>(`${authHost}/referral/send`, {
        method: 'POST',
        body: JSON.stringify({ recipient }),
      })
    ).map(() => undefined);
  },

  // Stripe HTTP methods (replacing RPC calls)
  async createCheckoutSessionV2(args: {
    successUrl: string;
    cancelUrl: string;
    discount?: string | null;
    metadata?: {
      gaClientId?: string | null;
      fbp?: string | null;
      fbc?: string | null;
    };
  }) {
    return (
      await fetchWithAuth<{ url: string }>(
        `${authHost}/user/stripe/checkoutv2`,
        {
          method: 'POST',
          body: JSON.stringify({
            successUrl: args.successUrl,
            cancelUrl: args.cancelUrl,
            discount: args.discount ?? undefined,
            metadata: args.metadata,
          }),
        }
      )
    ).map((result) => result.url);
  },

  async createPortalSession(args: { returnUrl: string }) {
    return (
      await fetchWithAuth<{ url: string }>(`${authHost}/user/stripe/portal`, {
        method: 'POST',
        body: JSON.stringify({
          returnUrl: args.returnUrl,
        }),
      })
    ).map((result) => result.url);
  },

  /**
   * Whether the signed-in user has a Cursor API key stored, and whether this
   * deployment accepts one at all.
   *
   * Never returns the key or any part of it — not even masked. There is no
   * screen that needs it, and a masked key still leaks its length.
   */
  async getCursorApiKeyStatus() {
    return (
      await fetchWithAuth<CursorApiKeyStatus, 'CURSOR_API_KEY_ERROR'>(
        `${authHost}/cursor-api-key`,
        {
          method: 'GET',
          errorResponseHandler: cursorApiKeyErrorResponseHandler,
        }
      )
    ).map((result) => result);
  },

  /**
   * Stores a Cursor API key for the signed-in user, replacing any existing one.
   *
   * The key is validated on shape alone, so a typo that still starts with
   * `crsr_` is accepted here and only fails when a session tries to use it.
   */
  async putCursorApiKey(apiKey: string) {
    return (
      await fetchWithAuth<CursorApiKeyStatus, 'CURSOR_API_KEY_ERROR'>(
        `${authHost}/cursor-api-key`,
        {
          method: 'PUT',
          body: JSON.stringify({ apiKey }),
          errorResponseHandler: cursorApiKeyErrorResponseHandler,
        }
      )
    ).map((result) => result);
  },

  /**
   * Forgets the signed-in user's Cursor API key.
   *
   * Does not revoke it at Cursor — the key keeps working everywhere else, and
   * only Cursor can revoke it. The UI has to say so.
   */
  async deleteCursorApiKey() {
    return (
      await fetchWithAuth<CursorApiKeyStatus, 'CURSOR_API_KEY_ERROR'>(
        `${authHost}/cursor-api-key`,
        {
          method: 'DELETE',
          errorResponseHandler: cursorApiKeyErrorResponseHandler,
        }
      )
    ).map((result) => result);
  },

  /**
   * The models the signed-in user's Cursor account offers, for the settings
   * dropdown. Asks Cursor live through the stored key, so it needs a connected
   * account — a caller with none gets the endpoint's own `409` message.
   */
  async listCursorModels() {
    return (
      await fetchWithAuth<CursorModelsResponse, 'CURSOR_API_KEY_ERROR'>(
        `${authHost}/cursor-api-key/models`,
        {
          method: 'GET',
          errorResponseHandler: cursorApiKeyErrorResponseHandler,
        }
      )
    ).map((result) => result);
  },

  /**
   * Chooses the model the user's sessions start on.
   */
  async putCursorDefaultModel(modelId: string) {
    return (
      await fetchWithAuth<CursorApiKeyStatus, 'CURSOR_API_KEY_ERROR'>(
        `${authHost}/cursor-api-key/default-model`,
        {
          method: 'PUT',
          body: JSON.stringify({ modelId }),
          errorResponseHandler: cursorApiKeyErrorResponseHandler,
        }
      )
    ).map((result) => result);
  },

  async checkGithubLinkStatus() {
    return (
      await fetchWithAuth<
        GithubLinkStatusResponse,
        GithubReauthenticationErrorCode
      >(`${authHost}/link/github/status`, {
        method: 'GET',
        errorResponseHandler: githubErrorResponseHandler,
      })
    ).map((result) => result);
  },

  async checkGmailLinkStatus() {
    return (
      await fetchWithAuth<
        GmailLinkStatusResponse,
        GithubReauthenticationErrorCode
      >(`${authHost}/link/gmail/status`, {
        method: 'GET',
        errorResponseHandler: githubErrorResponseHandler,
      })
    ).map((result) => result);
  },

  /**
   * Initializes the github account link for the user.
   * Returns the url you need to redirect user to to start the link.
   */
  async initGithubLink(originalUrl?: string) {
    const url = originalUrl
      ? `${authHost}/link/github?original_url=${encodeURIComponent(originalUrl)}`
      : `${authHost}/link/github`;
    return (
      await fetchWithAuth<InitGithubLinkResponse>(url, {
        method: 'POST',
      })
    ).map((result) => result.authorization_url);
  },

  /**
   * Initializes a gmail account link for the already-authenticated user (multi-inbox flow).
   * Returns the OAuth authorization URL to redirect the browser to.
   * After Google consent, the user is redirected back to `originalUrl` with `?link_id=<uuid>`
   * appended; the frontend then calls `emailClient.init({ linkId })` to provision the inbox.
   *
   * `scopes` selects which permissions the consent screen asks for. Only
   * calendar entry points may request calendar access, and an inbox that is
   * already connected should ask for `calendar` alone so the user isn't
   * re-consenting to mailbox access they have already granted.
   */
  async initGmailLink(
    originalUrl?: string,
    options?: { scopes?: ConsentScopes }
  ) {
    const params = new URLSearchParams();
    if (originalUrl) {
      params.set('original_url', encodeURIComponent(originalUrl));
    }
    if (options?.scopes) {
      params.set('scopes', options.scopes);
    }
    const query = params.toString();
    const url = query
      ? `${authHost}/link/gmail?${query}`
      : `${authHost}/link/gmail`;
    return (
      await fetchWithAuth<
        InitGmailLinkResponse,
        'PAYMENT_REQUIRED' | 'TOO_MANY_PENDING_LINKS'
      >(url, {
        method: 'POST',
        // The backend returns 402 when the user isn't entitled to additional
        // inboxes, and 429 when they have too many incomplete link attempts in
        // flight. Surface each as a distinct code so the add-inbox flow can open
        // the paywall or explain the wait instead of a generic failure.
        errorResponseHandler: async (response) => {
          if (response.status === 402) {
            return { code: 'PAYMENT_REQUIRED', message: 'Payment required' };
          }
          if (response.status === 429) {
            return {
              code: 'TOO_MANY_PENDING_LINKS',
              message: 'Too many pending inbox connections',
            };
          }
          return {
            code: 'HTTP_ERROR',
            message: `HTTP error! status: ${response.status}`,
          };
        },
      })
    ).map((result) => result);
  },

  /**
   * Deletes a github link for a user
   * NOTE: this does not delete the github application from being installed on a teams repository
   */
  async deleteGithubLink() {
    return (
      await fetchWithAuth<{}>(`${authHost}/link/github`, {
        method: 'DELETE',
      })
    ).map((_result) => {});
  },

  async reauthenticateGithub(originalUrl?: string) {
    const deleteResult = await authServiceClient.deleteGithubLink();
    if (deleteResult.isErr()) {
      return err(deleteResult.error);
    }

    return authServiceClient.initGithubLink(originalUrl);
  },

  async sendMobileWelcomeEmail(email: string) {
    return safeFetch<
      SendMobileWelcomeEmailResponse,
      'RATE_LIMITED' | 'INVALID_EMAIL'
    >(
      `${authHost}/mobile-welcome-email`,
      {
        method: 'POST',
        body: JSON.stringify({ email }),
        credentials: 'include',
      },
      async (response) => {
        if (response.status === 429) {
          return { code: 'RATE_LIMITED', message: 'Rate limit exceeded' };
        }
        if (response.status === 400) {
          return { code: 'INVALID_EMAIL', message: 'Invalid email address' };
        }
        return {
          code: 'HTTP_ERROR',
          message: `HTTP error! status: ${response.status}`,
        };
      }
    );
  },

  async getUserTeams() {
    return (
      await fetchWithAuth<Team[]>(`${authHost}/team/user`, { method: 'GET' })
    ).map((result) => result);
  },

  async getUserInvites() {
    return (
      await fetchWithAuth<TeamInvitesResponse>(
        `${authHost}/team/user/invites`,
        {
          method: 'GET',
        }
      )
    ).map((result) => result);
  },

  async getTeam() {
    return (
      (
        await fetchWithAuth<TeamWithMembers>(`${authHost}/team`, {
          method: 'GET',
        })
      )
        // A user with no team gets a 204 No Content, which `safeFetch`
        // surfaces as an empty object. Normalize that to `null` so callers
        // don't dereference a non-existent `team`/`members`.
        .map((result): TeamWithMembers | null =>
          'team' in result ? result : null
        )
    );
  },

  async getTeamInvites() {
    return (
      await fetchWithAuth<TeamInvitesResponse>(`${authHost}/team/invites`, {
        method: 'GET',
      })
    ).map((result) => result);
  },

  async createTeam(args: CreateTeamRequest) {
    return (
      await fetchWithAuth<Team>(`${authHost}/team`, {
        method: 'POST',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
  },

  async joinTeam(teamInviteId: string) {
    return (
      await fetchWithAuth<{}>(`${authHost}/team/join/${teamInviteId}`, {
        method: 'GET',
      })
    ).map(() => undefined);
  },

  async rejectInvitation(teamInviteId: string) {
    return (
      await fetchWithAuth<{}>(`${authHost}/team/join/${teamInviteId}`, {
        method: 'DELETE',
      })
    ).map(() => undefined);
  },

  async patchTeam(args: PatchTeamRequest) {
    return (
      await fetchWithAuth<{}>(`${authHost}/team`, {
        method: 'PATCH',
        body: JSON.stringify(args),
      })
    ).map(() => undefined);
  },

  async inviteToTeam(args: InviteToTeamRequest) {
    return (
      await fetchWithAuth<{}>(`${authHost}/team/invite`, {
        method: 'POST',
        body: JSON.stringify(args),
      })
    ).map(() => undefined);
  },

  /**
   * Toggles automatic domain joining for the caller's team: sets the
   * auto-join domain from the team owner's email domain when unset,
   * removes it when set. Returns the domain after the toggle (null when
   * it was just disabled). Admin/Owner only.
   */
  async toggleTeamAutoJoinDomain() {
    return (
      await fetchWithAuth<
        ToggleAutoJoinDomainResponse,
        ToggleAutoJoinDomainErrorCode
      >(`${authHost}/team/auto-join-domain/toggle`, {
        method: 'POST',
        // The backend rejects enabling auto-join for generic email
        // provider domains (e.g. gmail.com) with a 400 whose message
        // names the domain — keep that message so the UI can toast it
        // verbatim.
        errorResponseHandler: async (response) => {
          if (response.status === 400) {
            const message = await response
              .json()
              .then((body) => body?.message)
              .catch(() => undefined);
            return {
              code: 'GENERIC_DOMAIN_NOT_ALLOWED',
              message:
                typeof message === 'string'
                  ? message
                  : 'This domain cannot be used for auto-join',
            };
          }
          return {
            code: 'HTTP_ERROR',
            message: `HTTP error! status: ${response.status}`,
          };
        },
      })
    ).map((result) => result);
  },

  /**
   * Toggles whether non-admin members may invite users to the caller's
   * team. Teams start with this on (any member can invite); turning it
   * off restricts inviting to team admins and owners. Admin/Owner only.
   */
  async toggleTeamNonAdminInvites() {
    return (
      await fetchWithAuth<ToggleNonAdminInvitesResponse>(
        `${authHost}/team/non-admin-invites/toggle`,
        {
          method: 'POST',
        }
      )
    ).map((result) => result);
  },

  async deleteTeamInvite(teamInviteId: string) {
    return (
      await fetchWithAuth<{}>(`${authHost}/team/invite/${teamInviteId}`, {
        method: 'DELETE',
      })
    ).map(() => undefined);
  },

  async removeUserFromTeam(userId: string) {
    return (
      await fetchWithAuth<{}>(`${authHost}/team/remove/${userId}`, {
        method: 'DELETE',
      })
    ).map(() => undefined);
  },

  async deleteTeam() {
    return (
      await fetchWithAuth<{}>(`${authHost}/team`, {
        method: 'DELETE',
      })
    ).map(() => undefined);
  },
};

registerClient('auth', authServiceClient);
