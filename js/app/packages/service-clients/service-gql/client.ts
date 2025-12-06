import { cache } from '@core/util/cache';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import {
  err,
  isErr,
  type MaybeResult,
  mapOk,
  type ObjectLike,
  ok,
} from '@core/util/maybeResult';
import { registerClient } from '@core/util/mockClient';
import { getAccessToken } from '@service-auth/client';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { makePersisted } from '@solid-primitives/storage';
import { ENABLE_BEARER_TOKEN_AUTH } from 'core/constant/featureFlags';
import { createMemo, createResource, createSignal } from 'solid-js';

export const GQL_ENDPOINT = import.meta.env.__MACRO_GQL_SERVICE__;

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

export async function gqlFetch<T extends ObjectLike>(
  query: string,
  variables?: Record<string, any>
): Promise<MaybeResult<FetchWithTokenErrorCode, T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (ENABLE_BEARER_TOKEN_AUTH) {
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const result = await fetchWithToken<{ data: T; errors?: any[] }>(
    GQL_ENDPOINT,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ query, variables }),
      retry: {
        delay: 'exponential',
        maxTries: 3,
      },
    }
  );
  if (isErr(result)) return result;

  const [, { data, errors }] = result;
  if (errors && errors[0]) return err('GRAPHQL_ERROR', errors[0].message);
  return ok(data);
}

export const gqlServiceClient = {
  getUserInfo: cache(
    async function getUserPermissions() {
      const query = `
      query userPermissions {
        me {
          id
          permissions
          email
          name
          licenseStatus
          tutorialComplete
          hasChromeExt
          group
          stripe {
            id
            metadata {
              has_trialed
            }
            subscriptions {
              data {
                ... on StripeSubscriptionData {
                  id
                  trial_end
                  current_period_end
                  cancel_at_period_end
                }
              }
            }
          }
        }
      }
    `;
      return mapOk(
        await gqlFetch<
          Partial<{
            me: Partial<{
              id: string;
              permissions: MacroPermissions[];
              email: string;
              name: string;
              licenseStatus: string;
              tutorialComplete: boolean;
              group?: 'A' | 'B';
              hasChromeExt: boolean;
              stripe: {
                metadata: {
                  has_trialed: boolean;
                };
              };
            }>;
          }>
        >(query),
        (data) => ({
          ...data?.me,
          authenticated: !!data?.me?.id,
          userId: data?.me?.id,
          hasTrialed: data?.me?.stripe?.metadata?.has_trialed,
          group: data?.me?.group,
          hasChromeExt: data?.me?.hasChromeExt,
        })
      );
    },
    {
      seconds: 15,
    }
  ),
  async getOrganization() {
    const query = `
    query org {
      me {
        organization {
          id
          name
        }
      }
    }
  `;
    const maybeResult = await gqlFetch<{
      me: { organization: { id: string; name: string } | null };
    }>(query);
    if (isErr(maybeResult))
      return {
        organizationId: undefined,
        organizationName: undefined,
      };
    const [, res] = maybeResult;
    const id = res.me.organization?.id;
    const name = res.me.organization?.name;
    return { organizationId: id, organizationName: name };
  },

  async isUserInOrg() {
    const query = `
      query isUserInOrg {
        me {
          id
          organizationId
        }
      }
    `;
    return mapOk(
      await gqlFetch<{ me: { id: string; organizationId: string | null } }>(
        query
      ),
      (result) => ({
        isInOrg: !!result?.me.organizationId,
        organizationId: result.me.organizationId || undefined,
      })
    );
  },

  async completeOnboarding(args: CompleteOnboardingRequest) {
    const query = `
      mutation {
        onboarding(
          firstName: "${args.firstName}",
          lastName: "${args.lastName}",
          title: "${args.title}",
          industry: "${args.industry}"
        )
      }
    `;
    const response = await gqlFetch(query, { ...args });

    return mapOk(response, (result) => result);
  },
  async setGroup(args: SetGroupRequest) {
    const query = `
      mutation {
        setGroup(group: "${args.group}")
      }
    `;
    const response = await gqlFetch(query, { ...args });
    return mapOk(response, (result) => result);
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
      userId: undefined,
      authenticated: false,
      hasTrialed: false,
      group: undefined,
      hasChromeExt: false,
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

// TODO: remove unused code
//
// // Function to check if email domain has Google MX records
// export async function checkGoogleMXRecords(
//   emailAddress: string | undefined
// ): Promise<boolean> {
//   if (!emailAddress) return false;
//
//   try {
//     const domain = emailAddress.split('@')[1];
//     if (!domain) return false;
//
//     const response = await platformFetch(
//       `https://dns.google/resolve?name=${domain}&type=MX`
//     );
//     const data = await response.json();
//
//     if (data.Answer && Array.isArray(data.Answer)) {
//       return data.Answer.some(
//         (record: { data: string }) =>
//           record.data && record.data.includes('google.com')
//       );
//     }
//
//     return false;
//   } catch (error) {
//     console.error('Failed to check MX records:', error);
//     return false;
//   }
// }
//
// export function useHasGoogleMX() {
//   const email = useEmail();
//   const [hasGoogleMX] = createResource(email, checkGoogleMXRecords);
//   return hasGoogleMX;
// }
