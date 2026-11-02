import '@core/util/chunk-load-errors';
import { ensureFreshSession } from '@core/auth/session-refresh';
import { hasLoginCookie } from '@core/util/cookies';
import { fireAndForget } from '@core/util/fireAndForget';
import { isTauri } from '@core/util/platform';

// Cookie refresh is shared with every runtime consumer; this hint only allows
// checking a session. Identity and account data still wait for server auth.
// Native installs its cookie transport in the app entry before starting requests.
if (!isTauri() && hasLoginCookie()) {
  fireAndForget(ensureFreshSession(), 'session-bootstrap');
}
