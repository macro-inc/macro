import { DEV_MODE_ENV, LOCAL_ONLY } from '@core/constant/featureFlags';
import { createSignal } from 'solid-js';

export const tabTitleSignal = createSignal<string | undefined>();

function getEnvPrefix(): string {
  if (LOCAL_ONLY) {
    const port = window.location.port;
    if (port && port !== '3000') return `[L:${port.slice(-1)}] `;
    return '[L] ';
  }
  return DEV_MODE_ENV ? '[D] ' : '';
}

const ENV_PREFIX = getEnvPrefix();

export function formatTabTitle(title: string | undefined) {
  if (title) return `${ENV_PREFIX}Macro - ${title}`;
  return `${ENV_PREFIX}Macro`;
}
