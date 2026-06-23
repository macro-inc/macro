/// <reference types="../../app/vite-env.d.ts" />

import { datadogLogs } from '@datadog/browser-logs';
import { isInitialized, setInitialized } from './shared';

const clientToken = import.meta.env.VITE_DD_WEB_APP_TOKEN;
const env = import.meta.env.MODE === 'production' ? 'prod' : 'dev';
const service = 'web-app';
const site = 'us5.datadoghq.com';

// Route intake through the first-party analytics proxy (Cloudflare Worker) so
// ad blockers / tracking protection don't drop logs the way they block
// requests sent straight to *.datadoghq.com. The worker maps the `/i/dd`
// prefix to the us5 browser intake origin; see js/analytics-proxy.
const proxy = (options: { path: string; parameters: string }) =>
  `https://macro-prox.macroverse.workers.dev/i/dd${options.path}?${options.parameters}`;

interface User {
  id: string;
  email: string;
  [key: string]: any;
}

// init() is deferred to an idle callback, so setUser() can run before the SDK
// is ready. Buffer the latest user and apply it once initialized.
let pendingUser: User | undefined;

export function init(version = import.meta.env.__APP_VERSION__) {
  if (import.meta.hot || isInitialized()) return;

  datadogLogs.init({
    clientToken,
    env,
    version,
    service,
    site,
    proxy,
    // Catch exceptions without RUM: forwards uncaught exceptions, unhandled
    // promise rejections, and failed network requests (XHR/fetch) to Datadog
    // as error-level logs (with stack traces).
    forwardErrorsToLogs: true,
    // Also forward explicit console.error() calls.
    forwardConsoleLogs: ['error'],
    // Forward browser Reporting API entries (CSP violations, deprecations,
    // interventions).
    forwardReports: 'all',
    telemetrySampleRate: 0,
    beforeSend: (event, _context) => {
      if (event.message.includes('unfurl-service')) return false;

      // these are from VList and can be ignored: https://github.com/inokawa/virtua?tab=readme-ov-file#what-is-resizeobserver-loop-completed-with-undelivered-notifications-error
      if (
        event.message.includes(
          'ResizeObserver loop completed with undelivered notifications'
        )
      )
        return false;

      return true;
    },
  });

  setInitialized(true);

  if (pendingUser) datadogLogs.setUser(pendingUser);
}

export function setUser(user: User) {
  pendingUser = user;
  if (isInitialized()) datadogLogs.setUser(user);
}

// Drop the user from log context on logout so logs aren't attributed to a
// signed-out user. Mirrors the analytics.reset() in the logout flow.
export function clearUser() {
  pendingUser = undefined;
  if (isInitialized()) datadogLogs.clearUser();
}

export { error, log, logger } from './logger';
