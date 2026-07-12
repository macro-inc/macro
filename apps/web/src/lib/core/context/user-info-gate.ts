import { hasLoginCookie } from '@core/util/cookies';
import { createSignal } from 'solid-js';

const [shouldQueryUserInfo, setShouldQueryUserInfo] = createSignal(
  hasLoginCookie()
);

export { shouldQueryUserInfo };

export function enableUserInfoQuery() {
  setShouldQueryUserInfo(true);
}
