import type { ResultType } from '@core/util/maybeResult';
import type { authServiceClient } from '@service-auth/client';

export type MaybeAuthUserInfo = Awaited<
  ReturnType<typeof authServiceClient.getUserInfo>
>;

export type AuthUserInfo = ResultType<MaybeAuthUserInfo>;

export type AuthStateChange = {
  from?: AuthState;
  to?: AuthState;
};

export enum AuthState {
  /** User is not authenticated */
  Undefined = 'undefined',
  /** User was previously unauthenticated, and now we have authentication information
   * eg. the user logged in*/
  Authenticated = 'authenticated',
  /** User was previously authenticated, and now we have unauthenticated information
   * eg. the user logged out*/
  Unauthenticated = 'unauthenticated',
  /** user info has errored out */
  Error = 'error',
}
