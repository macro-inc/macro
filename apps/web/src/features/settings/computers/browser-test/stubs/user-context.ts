import type { ParentProps } from 'solid-js';

/** A signed-in fixture person, Maya, with no permissions or app state. */
const user = {
  userInfo: () => undefined,
  isLoading: () => false,
  isAuthenticated: () => true,
  userId: () => 'maya@example.com',
  email: () => 'maya@example.com',
  permissions: () => [] as string[],
  author: () => 'Maya',
  licenseStatus: () => undefined,
  tutorialCompleted: () => true,
  group: () => undefined,
  hasChromeExt: () => false,
  hasTrialed: () => false,
  aiDataConsent: () => false,
  referralCode: () => undefined,
};

export function UserContextProvider(props: ParentProps) {
  return props.children;
}
export const useUserContext = () => user;
export const useIsAuthenticated = () => user.isAuthenticated;
export const useUserId = () => user.userId;
export const useEmail = () => user.email;
export const usePermissions = () => user.permissions;
export const useHasPermission = () => () => false;
export const useAuthor = () => user.author;
export const useLicenseStatus = () => user.licenseStatus;
export const useTutorialCompleted = () => user.tutorialCompleted;
export const useUserInfo = () => user.userInfo;
export const useAiDataConsent = () => user.aiDataConsent;
export const useReferralCode = () => user.referralCode;
export const deriveIsAuthenticated = () => true;
