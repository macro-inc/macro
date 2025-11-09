/// <reference types="../../app/vite-env.d.ts" />

import { SERVER_HOSTS } from '@core/constant/servers';
import { datadogLogs } from '@datadog/browser-logs';
import { datadogRum } from '@datadog/browser-rum';
import { isInitialized, setInitialized } from './shared';

const applicationId = import.meta.env.VITE_DD_WEB_APP_ID;
const clientToken = import.meta.env.VITE_DD_WEB_APP_TOKEN;
const env = import.meta.env.MODE === 'production' ? 'prod' : 'dev';
const service = 'web-app';
const site = 'us5.datadoghq.com';

const tracingHosts =
  env === 'prod'
    ? [
        SERVER_HOSTS['auth-service'],
        SERVER_HOSTS['cognition-service'],
        SERVER_HOSTS['comms-service'],
        SERVER_HOSTS['document-storage-service'],
        SERVER_HOSTS['email-service'],
        SERVER_HOSTS['notification-service'],
        SERVER_HOSTS['search-service'],
      ]
    : Object.values(SERVER_HOSTS);

export function init(version = import.meta.env.__APP_VERSION__) {
  if (import.meta.hot || isInitialized()) return;

  datadogRum.init({
    applicationId,
    clientToken,
    env,
    version,
    service,
    site,
    sessionSampleRate: 100,
    sessionReplaySampleRate: 0,
    allowFallbackToLocalStorage: true,
    trackUserInteractions: true,
    trackResources: true,
    trackLongTasks: true,
    actionNameAttribute: 'data-action-name',
    defaultPrivacyLevel: 'mask',
    excludedActivityUrls: [
      (url) => new URL(url).hostname.includes('analytics'),
    ],
    allowedTracingUrls: tracingHosts.map((host) => ({
      match: host,
      propagatorTypes: ['tracecontext'],
    })),
    trackViewsManually: true,
    beforeSend: (event, _context) => {
      if (event.type === 'resource' && event.status_code !== 200) {
        if (event.resource.url.includes('unfurl-service')) return false;
      }

      // these are from VList and can be ignored: https://github.com/inokawa/virtua?tab=readme-ov-file#what-is-resizeobserver-loop-completed-with-undelivered-notifications-error
      if (
        event.type === 'error' &&
        event.error.message.includes(
          'ResizeObserver loop completed with undelivered notifications'
        )
      )
        return false;

      return true;
    },
  });

  datadogLogs.init({
    clientToken,
    env,
    version,
    service,
    site,
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
}

interface User {
  id: string;
  email: string;
  [key: string]: any;
}
export function setUser(user: User) {
  datadogRum.setUser(user);
  datadogLogs.setUser(user);
}

export { startAction } from './actionTracker';
export { error, log, logger } from './logger';
export { useObserveRouting } from './routingTracker';
