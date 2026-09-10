// Stub for `@core/context/user` for the standalone marketing "live editor"
// embed. The real module queries the auth service for the signed-in user; the
// embed has no auth, so every accessor returns an empty/unauthenticated value.
import type { Accessor, JSX } from 'solid-js';

const acc =
  <T,>(value: T): Accessor<T> =>
  () =>
    value;

export function UserContextProvider(props: { children?: JSX.Element }) {
  return props.children;
}

export const useUserContext = (): any => ({
  userInfo: acc(undefined),
  isLoading: acc(false),
  isAuthenticated: acc(false),
  userId: acc(undefined),
  email: acc(undefined),
  permissions: acc<string[]>([]),
  author: acc('Macro User'),
  licenseStatus: acc(undefined),
  tutorialCompleted: acc(undefined),
  group: acc(undefined),
  hasChromeExt: acc(undefined),
  hasTrialed: acc(undefined),
  aiDataConsent: acc(false),
  referralCode: acc(undefined),
});

export const useIsAuthenticated = () => acc(false);
export const useUserId = () => acc<string | undefined>(undefined);
export const useEmail = () => acc<string | undefined>(undefined);
export const usePermissions = () => acc<string[]>([]);
export const useHasPermission = (_id?: unknown) => acc(false);
export const useAuthor = () => acc('Macro User');
export const useLicenseStatus = () => acc<string | undefined>(undefined);
export const useTutorialCompleted = () => acc<boolean | undefined>(undefined);
export const useUserInfo = () => acc<unknown>(undefined);
export const useAiDataConsent = () => acc(false);
export const useReferralCode = () => acc<string | undefined>(undefined);
