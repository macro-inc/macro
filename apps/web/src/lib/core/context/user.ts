import type { PermissionId } from '@core/constant/permissions';
import { thrownResultErrorHasCode } from '@core/util/result';
import { type UserInfoData, useUserInfoQuery } from '@queries/auth/user-info';
import { queryReadyGate } from '@queries/gate';
import { type Accessor, createMemo } from 'solid-js';
import { createAssertedContextProvider } from './createContext';
import { shouldQueryUserInfo } from './user-info-gate';

type UserContextValue = {
  userInfo: Accessor<UserInfoData | undefined>;
  isLoading: Accessor<boolean>;
  isAuthenticated: Accessor<boolean | undefined>;
  userId: Accessor<string | undefined>;
  email: Accessor<string | undefined>;
  permissions: Accessor<string[]>;
  author: Accessor<string>;
  licenseStatus: Accessor<string | undefined>;
  tutorialCompleted: Accessor<boolean | undefined>;
  group: Accessor<string | null | undefined>;
  hasChromeExt: Accessor<boolean | undefined>;
  hasTrialed: Accessor<boolean | undefined>;
  aiDataConsent: Accessor<boolean>;
  referralCode: Accessor<string | undefined>;
};

/**
 * Derives the auth state from the user-info query. Data-first: a failed
 * background refetch keeps the previous data alongside the error, and the
 * last-known auth state must survive it — otherwise an offline cold start
 * that restored user-info from cache drops all auth-gated chrome.
 */
export function deriveIsAuthenticated(
  query: Pick<
    ReturnType<typeof useUserInfoQuery>,
    'isLoading' | 'isError' | 'error' | 'data'
  >
): boolean | undefined {
  // Only a 401 proves the user is signed out; it wins even over retained data.
  if (thrownResultErrorHasCode(query.error, 'UNAUTHORIZED')) return false;
  if (query.data) return query.data.authenticated ?? false;
  // No data and no definitive signal: a transient failure (network blip, 5xx)
  // leaves the auth state unknown so consumers don't bounce an authenticated
  // user to login.
  if (query.isLoading || query.isError) return undefined;
  return false;
}

export const [UserContextProvider, useUserContext] =
  createAssertedContextProvider('UserContext', (): UserContextValue => {
    const query = useUserInfoQuery({ enabled: shouldQueryUserInfo });

    const userInfo = createMemo(() =>
      queryReadyGate(query) ? query.data : undefined
    );

    const isLoading = () => query.isLoading;

    const isAuthenticated = createMemo(() => deriveIsAuthenticated(query));

    const userId = createMemo(() => userInfo()?.id);
    const email = createMemo(() => userInfo()?.email);
    const permissions = createMemo(() => userInfo()?.permissions ?? []);
    const author = createMemo(
      () => userInfo()?.name || userInfo()?.email || 'Macro User'
    );
    const licenseStatus = createMemo(() => userInfo()?.licenseStatus);
    const tutorialCompleted = createMemo(() => userInfo()?.tutorialComplete);
    const group = createMemo(() => userInfo()?.group);
    const hasChromeExt = createMemo(() => userInfo()?.hasChromeExt);
    const hasTrialed = createMemo(() => userInfo()?.hasTrialed);
    const aiDataConsent = createMemo(() => userInfo()?.aiDataConsent ?? false);
    const referralCode = createMemo(() => userInfo()?.referralCode);

    return {
      userInfo,
      isLoading,
      isAuthenticated,
      userId,
      email,
      permissions,
      author,
      licenseStatus,
      tutorialCompleted,
      group,
      hasChromeExt,
      hasTrialed,
      aiDataConsent,
      referralCode,
    };
  });

// Convenience hooks that return individual accessors
export function useIsAuthenticated() {
  return useUserContext().isAuthenticated;
}

export function useUserId() {
  return useUserContext().userId;
}

export function useEmail() {
  return useUserContext().email;
}

export function usePermissions() {
  return useUserContext().permissions;
}

/** Reactive check for whether the current user has a specific permission. */
export function useHasPermission(id: PermissionId): Accessor<boolean> {
  const permissions = usePermissions();
  return () => permissions().includes(id);
}

export function useAuthor() {
  return useUserContext().author;
}

export function useLicenseStatus() {
  return useUserContext().licenseStatus;
}

export function useTutorialCompleted() {
  return useUserContext().tutorialCompleted;
}

function _useGroup() {
  return useUserContext().group;
}

function _useHasChromeExt() {
  return useUserContext().hasChromeExt;
}

function _useHasTrialed() {
  return useUserContext().hasTrialed;
}

export function useUserInfo() {
  return useUserContext().userInfo;
}

export function useAiDataConsent() {
  return useUserContext().aiDataConsent;
}

export function useReferralCode() {
  return useUserContext().referralCode;
}
