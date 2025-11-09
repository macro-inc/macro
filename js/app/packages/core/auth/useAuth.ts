import { authServiceClient } from '@service-auth/client';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { createEffect, createMemo, createResource, createRoot } from 'solid-js';
import { defaultFromPersisted, persistedUserInfo } from './persist';
import { AuthState, type AuthStateChange, type AuthUserInfo } from './types';

function matchChange(
  stateChange: AuthStateChange,
  matchChange?: AuthStateChange
): boolean {
  if (!matchChange) return true;

  if (matchChange.from && stateChange.from !== matchChange.from) return false;
  if (matchChange.to && stateChange.to !== matchChange.to) return false;

  return true;
}

export const useAuthUserInfo = createSingletonRoot(() =>
  createResource(authServiceClient.getUserInfo, {
    initialValue: persistedUserInfo[0](),
    storage: () => persistedUserInfo as any,
  })
);

export function useIsAuthenticated() {
  const [u] = useAuthUserInfo();
  return createMemo((): boolean | undefined => {
    const [errs, user] = u.latest;
    return !errs && user.authenticated;
  });
}

export function useIsOrganizationMember() {
  const [u] = useAuthUserInfo();
  return createMemo((): boolean | undefined => {
    const [errs, user] = u.latest;
    return !errs && user.organizationId !== undefined;
  });
}

export async function updateUserAuth() {
  const [, { refetch }] = useAuthUserInfo();
  return refetch();
}

/** Creates an effect that runs the callback whenever the user's auth state changes
 *
 * @param cb - The callback to run when the state changes
 * @param changeToMatch - control a specific state change event to subscribe to
 * only one (from or to) is required, if you only care about one of the states
 *
 * @example subscribing to a specific auth state change
 * ```typescript
 * createAuthChangeEffect(
 *   (stateChange, info) => {
 *     console.log('User has logged in');
 *   },
 *   { from: AuthState.Undefined, to: AuthState.Authenticated }
 * );
 * ```
 *
 * @example subscribing to a specific auth state change
 * ```typescript
 * createAuthChangeEffect(
 *   (stateChange, info) => {
 *     if (stateChange.from === AuthState.Undefined &&
 *         stateChange.to === AuthState.Authenticated) {
 *       console.log('User has logged in');
 *     }
 *   }
 * );
 * ```
 */
export function createAuthChangeEffect(
  cb: (stateChange: AuthStateChange, info: AuthUserInfo) => void,
  changeToMatch?: AuthStateChange
) {
  createRoot(() =>
    createEffect((prev: [AuthState, AuthUserInfo]) => {
      const [userInfo] = useAuthUserInfo();
      const [prevState, prevInfo] = prev;
      const [err, info] = userInfo.latest;

      let currentState: AuthState;
      let data = info;

      if (err) {
        currentState = AuthState.Error;
      } else if (info.authenticated === true) {
        currentState = AuthState.Authenticated;
      } else if (info.authenticated === false) {
        currentState = AuthState.Unauthenticated;
      } else {
        currentState = AuthState.Undefined;
      }

      let stateChange = { from: prevState, to: currentState };

      if (!data) return [prevState, prevInfo];

      const stateChanged = prevState !== currentState;
      const infoChanged = prevInfo !== info;

      if (matchChange(stateChange, changeToMatch)) {
        if (stateChanged) {
          cb({ from: prevState, to: currentState }, data);
        } else if (currentState === AuthState.Authenticated && infoChanged) {
          cb(
            { from: AuthState.Authenticated, to: AuthState.Authenticated },
            data
          );
        }
      }

      return [currentState, info];
    }, defaultFromPersisted(persistedUserInfo))
  );
}
