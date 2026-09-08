/**
 * Stub for @core/context/user, swapped in by the demo's Vite config.
 *
 * The real module's provider builds its value from useUserInfoQuery, which
 * needs the query client and an authenticated session — neither of which exists
 * here. Rather than stand up the query layer just to satisfy an assertion, the
 * whole module is redirected to this one for the demo build.
 *
 * The demo has a single anonymous author who is always signed out. Anything
 * that branches on authentication therefore takes the signed-out path, which is
 * what a marketing visitor should see.
 */
import type { JSX } from 'solid-js';

const DEMO_USER_ID = 'marketing-demo-user';

/** Passes children straight through; there is no value to build. */
export function UserContextProvider(props: { children: JSX.Element }) {
  return props.children;
}

export function useUserContext() {
  return {
    userInfo: () => undefined,
    isLoading: () => false,
    isAuthenticated: () => false,
    userId: () => DEMO_USER_ID,
    email: () => undefined,
    permissions: () => [] as string[],
    author: () => 'You',
    licenseStatus: () => undefined,
    tutorialCompleted: () => true,
    group: () => null,
    hasChromeExt: () => false,
    hasTrialed: () => false,
    aiDataConsent: () => false,
    referralCode: () => undefined,
  };
}

export function deriveIsAuthenticated() {
  return false;
}

export const useIsAuthenticated = () => () => false;
/** Non-undefined: presence and diff attribution key off this. */
export const useUserId = () => () => DEMO_USER_ID;
export const useEmail = () => () => undefined;
export const usePermissions = () => () => [] as string[];
export const useHasPermission = () => () => false;
export const useAuthor = () => () => 'You';
export const useLicenseStatus = () => () => undefined;
export const useTutorialCompleted = () => () => true;
export const useUserInfo = () => () => undefined;
export const useAiDataConsent = () => () => false;
export const useReferralCode = () => () => undefined;
