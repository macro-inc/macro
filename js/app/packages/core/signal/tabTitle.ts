import { createSignal } from 'solid-js';
import { DEV_MODE_ENV, LOCAL_ONLY } from '@core/constant/featureFlags';

export const tabTitleSignal = createSignal<string | undefined>();

const ENV_PREFIX = LOCAL_ONLY ? '[L] ' : DEV_MODE_ENV ? '[D] ' : '';

export function formatTabTitle(title: string | undefined) {
  if (title) return `${ENV_PREFIX}Macro - ${title}`;
  return `${ENV_PREFIX}Macro`;
}
