import { createBlockSignal } from '@core/block';

export const pendingLocationParamsSignal =
  createBlockSignal<Record<string, string | undefined>>();
