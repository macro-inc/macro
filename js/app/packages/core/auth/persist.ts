import { isErr } from '@core/util/maybeResult';
import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';
import { AuthState, type AuthUserInfo, type MaybeAuthUserInfo } from './types';

const defaultUserInfo: AuthUserInfo = {
  id: '',
  userId: '',
  authenticated: false,
  permissions: [],
  email: '',
  name: null,
  licenseStatus: '',
  tutorialComplete: false,
  group: null,
  hasChromeExt: false,
  hasTrialed: false,
};

export const persistedUserInfo = makePersisted(
  createSignal<MaybeAuthUserInfo>([null, { ...defaultUserInfo }]),
  {
    name: 'authUserInfo',
  }
);

/** Creates the default effect data from the persisted user info */
export function defaultFromPersisted(
  info: typeof persistedUserInfo
): [AuthState, AuthUserInfo] {
  const [resource] = info;

  let result = resource();
  if (isErr(result)) return [AuthState.Undefined, { ...defaultUserInfo }];
  const [_, data] = result;

  return [AuthState.Authenticated, data];
}
