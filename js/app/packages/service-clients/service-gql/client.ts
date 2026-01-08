import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import { cache } from '@core/util/cache';
import { err, ok } from '@core/util/maybeResult';
import { registerClient } from '@core/util/mockClient';
import { getAccessToken } from '@service-auth/client';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { makePersisted } from '@solid-primitives/storage';
import { createMemo, createResource, createSignal } from 'solid-js';
import { LegacyApiRpcClient } from '../../codegen/auth_service/auth_service_rpc';

// Create a singleton instance of the RPC client
let rpcClientInstance: LegacyApiRpcClient | null = null;
let headers: Headers | null = null;

async function getRpcClient(): Promise<LegacyApiRpcClient> {
  if (headers == null) {
    headers = new Headers();

    if (ENABLE_BEARER_TOKEN_AUTH) {
      const token = await getAccessToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }
  }

  if (!rpcClientInstance) {
    rpcClientInstance = LegacyApiRpcClient.construct_with_headers(
      `${SERVER_HOSTS['auth-service']}/user`,
      () => headers
    );
  }
  return rpcClientInstance;
}

// TODO: bake this as middleware in the generated client
async function withRetryOn401<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // NOTE: this is the response from the generated client for a 401 error
      const is401 = typeof error === 'string' && error.includes('401');

      if (!is401 || attempt === maxRetries) {
        throw error;
      }

      headers = null;

      const backoffMs = (attempt + 1) * 100;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError;
}

export enum MacroPermissions {
  /** Able to use editor feature */
  ReadDocxEditor = 'ReadDocxEditor',
  /** Use the premium (paywalled) features in the client app */
  ReadProfessionalFeatures = 'ReadProfessionalFeatures',
  /** Modify and make changes to the admin panel */
  WriteAdminPanel = 'WriteAdminPanel',
  /** Able to use Macro AI features */
  WriteAiFeatures = 'WriteAiFeatures',
  /** Access hosted parsing API */
  WriteApiOnline = 'WriteApiOnline',
  /** Able to generate discount codes */
  WriteDiscount = 'WriteDiscount',
  /** Load any file into the online CoParse viewer */
  WriteDocOnline = 'WriteDocOnline',
  /** Able to use the email compare tool */
  WriteEmailTool = 'WriteEmailTool',
  /** Modify a stripe subscription for an enterprise organization */
  WriteEnterpriseSubscription = 'WriteEnterpriseSubscription',
  /** Able to access the IT Panel for an organization */
  WriteItPanel = 'WriteItPanel',
  /** Ability for User to Access and send out release notifications */
  WriteReleaseEmail = 'WriteReleaseEmail',
  /** Allows the user to modify and create stripe subscriptions */
  WriteStripeSubscription = 'WriteStripeSubscription',
}

type CompleteOnboardingRequest = {
  firstName: string;
  lastName: string;
  title: string;
  industry: string;
};

type SetGroupRequest = {
  group: string;
};

export const gqlServiceClient = {
  getUserInfo: cache(
    async function getUserPermissions() {
      try {
        const data = await withRetryOn401(async () => {
          const client = await getRpcClient();
          return await client.get_legacy_user_permissions();
        });

        return ok({
          id: data.userId,
          permissions: data.permissions as MacroPermissions[],
          email: data.email,
          name: data.name,
          licenseStatus: data.licenseStatus,
          tutorialComplete: data.tutorialComplete,
          group: data.group,
          hasChromeExt: data.hasChromeExt,
          authenticated: !!data.userId,
          userId: data.userId,
          hasTrialed: data.hasTrialed,
        });
      } catch (error) {
        return err('NETWORK_ERROR', String(error));
      }
    },
    {
      seconds: 15,
    }
  ),
  async getOrganization() {
    try {
      const result = await withRetryOn401(async () => {
        const client = await getRpcClient();
        return await client.get_user_organization();
      });

      if (!result) {
        return {
          organizationId: undefined,
          organizationName: undefined,
        };
      }

      return {
        organizationId: String(result.organizationId),
        organizationName: result.organizationName,
      };
    } catch (_error) {
      return {
        organizationId: undefined,
        organizationName: undefined,
      };
    }
  },

  async isUserInOrg() {
    try {
      const result = await withRetryOn401(async () => {
        const client = await getRpcClient();
        return await client.get_user_organization();
      });

      return ok({
        isInOrg: !!result,
        organizationId: result ? String(result.organizationId) : undefined,
      });
    } catch (error) {
      return err('NETWORK_ERROR', String(error));
    }
  },

  async completeOnboarding(args: CompleteOnboardingRequest) {
    try {
      await withRetryOn401(async () => {
        const client = await getRpcClient();
        return await client.patch_user_onboarding(args);
      });
      return ok(undefined);
    } catch (error) {
      return err('NETWORK_ERROR', String(error));
    }
  },
  async setGroup(args: SetGroupRequest) {
    try {
      await withRetryOn401(async () => {
        const client = await getRpcClient();
        return await client.patch_user_group(args);
      });
      return ok(undefined);
    } catch (error) {
      return err('NETWORK_ERROR', String(error));
    }
  },
};

registerClient('gql', gqlServiceClient);

/**
 * Checks if a given permission constraint is satisfied by the user's permissions.
 *
 * @param constraint - A string or function that returns a string representing the required permission.
 * @param permissions - An array of the user's permissions.
 * @returns A boolean indicating whether the user has the required permission.
 *
 * @example
 * const hasPermission = checkConstraintInPermissions('READ', userPermissions);
 */
function checkConstraintInPermissions(
  constraint: string | (() => string),
  permissions: MacroPermissions[] | undefined
): boolean {
  const required = typeof constraint === 'function' ? constraint() : constraint;
  return (
    permissions?.includes(
      MacroPermissions[required as keyof typeof MacroPermissions]
    ) ?? false
  );
}

/**
 * @deprecated Use `useIsAuthenticated` hook instead.
 *
 * A higher-order function that wraps a function with permission checking.
 *
 * @param constraint - A string or function that returns a string representing the required permission.
 * @param next - The function to be executed if the user has the required permission.
 * @param fallback - An optional function to be executed if the user doesn't have the required permission.
 * @returns A new function that checks permissions before executing the original function.
 *
 * @example
 * const protectedFunction = withAuthentication(
 *   'READ',
 *   () => console.log('Access granted'),
 *   () => console.log('Access denied')
 * );
 * protectedFunction();
 *
 */
export function withAuthentication<T extends Array<any>, U>(
  constraint: string | (() => string),
  next: (...args: T) => U,
  fallback?: () => U
): (...args: T) => Promise<U> {
  return async (...args: T) => {
    const result = await gqlServiceClient.getUserInfo();
    if (result[0]) {
      throw new Error('Failed to fetch user permissions');
    }
    const { permissions } = result[1];

    const isValid = checkConstraintInPermissions(constraint, permissions);

    if (!isValid) {
      if (fallback) {
        return fallback();
      }
      throw new Error(
        "You don't have permission to do this, please check your license"
      );
    }

    return next(...args);
  };
}

const persistedUserInfo = makePersisted(
  createSignal<Awaited<ReturnType<typeof gqlServiceClient.getUserInfo>>>([
    null,
    {
      userId: '',
      authenticated: false,
      hasTrialed: false,
      group: null,
      hasChromeExt: false,
      id: '',
      permissions: [],
      email: '',
      name: null,
      licenseStatus: '',
      tutorialComplete: false,
    },
  ]),
  {
    name: 'userInfo',
  }
);

// TODO: reconcile with auth service useUserInfo?
export const useUserInfo = createSingletonRoot(() =>
  createResource(gqlServiceClient.getUserInfo, {
    initialValue: persistedUserInfo[0](),
    storage: () => persistedUserInfo as any,
  })
);

export function updateUserInfo() {
  const [, { refetch }] = useUserInfo();
  return refetch();
}

export function useTutorialCompleted() {
  const [userInfo] = useUserInfo();
  return createMemo((): boolean | undefined => {
    const [err, info] = userInfo.latest;
    if (err) return;
    return info.tutorialComplete;
  });
}

export function useAuthor() {
  const [userInfo] = useUserInfo();
  return createMemo((): string | undefined => {
    const [err, info] = userInfo.latest;
    if (err) return;
    return info.name || info.email || 'Macro User';
  });
}

export function usePermissions() {
  const [userInfo] = useUserInfo();
  return createMemo((): MacroPermissions[] | undefined => {
    const [err, info] = userInfo.latest;
    if (err) return;
    return info.permissions || [];
  });
}

export function useEmail() {
  const [userInfo] = useUserInfo();
  return createMemo((): string | undefined => {
    const [err, info] = userInfo.latest;
    if (err) return;
    return info.email;
  });
}

export function useUserId() {
  const [userInfo] = useUserInfo();
  return createMemo((): string | undefined => {
    const [err, info] = userInfo.latest;
    if (err) return;
    return info.userId;
  });
}

export function useLicenseStatus() {
  const [userInfo] = useUserInfo();
  return createMemo((): string | undefined => {
    const [err, info] = userInfo.latest;
    if (err) return;
    return info.licenseStatus;
  });
}
