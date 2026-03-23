import { createSignal } from 'solid-js';
import { hasLoginCookie } from '@core/util/cookies';

const [shouldQueryUserInfo, setShouldQueryUserInfo] = createSignal(
  hasLoginCookie()
);

export { shouldQueryUserInfo };

export function enableUserInfoQuery() {
  setShouldQueryUserInfo(true);
}
