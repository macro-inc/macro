import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import {
  type MaybeError,
  type MaybeResult,
  mapOk,
  type ObjectLike,
} from '@core/util/maybeResult';
import { registerClient } from '@core/util/mockClient';
import type { SafeFetchInit } from '@core/util/safeFetch';

import type {
  IOrganizationSettings,
  IOrganizationUserInternal as IOrganizationUser,
} from './models';

export type * from './models';

// Define the organization service host
const orgHost: string = SERVER_HOSTS['organization-service'];

// orgFetch function with overloads to handle different response types
export function orgFetch(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeError<FetchWithTokenErrorCode>>;
export function orgFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeResult<FetchWithTokenErrorCode, T>>;
export function orgFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<MaybeResult<FetchWithTokenErrorCode, T>>
  | Promise<MaybeError<FetchWithTokenErrorCode>> {
  return fetchWithToken<T>(`${orgHost}${url}`, init);
}

export type Success = { success: boolean };
type SuccessResponse = { data: Success };

// Organization Service Client Implementation
export const organizationServiceClient = {
  /**
   * Retrieves all organization users with pagination
   */
  async getUsers(args: { limit: number; offset: number }) {
    const { limit, offset } = args;
    return mapOk(
      await orgFetch<{
        users: IOrganizationUser[];
        total: number;
        next_offset: number;
      }>(`/users?limit=${limit}&offset=${offset}`, {
        method: 'GET',
      }),
      (result) => result
    );
  },

  /**
   * Deletes a user by their ID
   */
  async deleteUser(args: { userId: string }) {
    const { userId } = args;
    return mapOk(
      await orgFetch<SuccessResponse>('/users', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
        }),
      }),
      (result) => result.data
    );
  },

  /**
   * Updates a user's role within the organization
   */
  async patchUserRole(args: { userId: string; role: 'owner' | 'member' }) {
    const { userId, role } = args;
    return orgFetch<SuccessResponse>('/users/role', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: userId,
        organization_user_role: role,
      }),
    });
  },

  /**
   * Invites a new user to the organization via email
   */
  async inviteUser(args: { email: string }) {
    const { email } = args;
    return orgFetch<SuccessResponse>('/users/invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
      }),
    });
  },

  /**
   * Retrieves a list of invited users
   */
  async getInvitedUsers() {
    return mapOk(
      await orgFetch<{
        invited_users: string[];
      }>(`/users/invited`, {
        method: 'GET',
      }),
      (result) => result
    );
  },

  /**
   * Revokes an invite for a user by their email
   */
  async revokeUserInvite(args: { email: string }) {
    const { email } = args;
    return orgFetch<SuccessResponse>('/users/invite', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
      }),
    });
  },

  /**
   * Retrieves the organization's settings
   */
  async getOrganizationSettings() {
    return mapOk(
      await orgFetch<IOrganizationSettings>('/organization/settings', {
        method: 'GET',
      }),
      (result) => result
    );
  },

  /**
   * Updates the organization's settings
   */
  async patchOrganizationSettings(args: {
    retention_days?: number;
    remove_default_share_permission?: boolean;
    remove_retention_days?: boolean;
  }) {
    return orgFetch<SuccessResponse>('/organization/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
  },

  /**
   * Updates the organization's share permissions
   */
  async updateSharePermissions(
    share_type: 'public' | 'private' | 'organization'
  ) {
    return orgFetch<SuccessResponse>(`/organization/share/${share_type}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
    });
  },
};

// Register the organization service client
registerClient('organization', organizationServiceClient);
