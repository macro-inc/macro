import { hasLoginCookie } from '@core/util/cookies';
import { createSignal } from 'solid-js';

// Preview hosts share HttpOnly dev auth cookies on .macro.com, but not the
// host-only login hint or localStorage from dev.macro.com. Probe identity there
// even without a hint; account services still require confirmed authentication.
const [shouldQueryUserInfo, setShouldQueryUserInfo] = createSignal(
  hasLoginCookie() ||
    (typeof window !== 'undefined' &&
      window.location.hostname.endsWith('.preview.macro.com'))
);

export { shouldQueryUserInfo };

export function enableUserInfoQuery() {
  setShouldQueryUserInfo(true);
}

// A login popup or sibling tab updates the shared login marker. It is only a
// hint to check identity, never proof that account services may start.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', () => {
    if (hasLoginCookie()) enableUserInfoQuery();
  });
}
