import { deriveIsAuthenticated, sessionStatus } from '@core/auth/session';
import type { PermissionId } from '@core/constant/permissions';
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

export const [UserContextProvider, useUserContext] =
  createAssertedContextProvider('UserContext', (): UserContextValue => {
    const query = useUserInfoQuery({ enabled: shouldQueryUserInfo });

    const userInfo = createMemo(() =>
      queryReadyGate(query) ? query.data : undefined
    );

    const isLoading = () => query.isLoading;

    // An expired session reads as signed out even while user-info still holds
    // the old identity, which is what routes it to sign-in.
    const isAuthenticated = createMemo(() =>
      sessionStatus() === 'expired'
        ? false
        : deriveIsAuthenticated({
            isLoading: query.isLoading,
            isError: query.isError,
            error: query.error,
            data: userInfo(),
          })
    );

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
