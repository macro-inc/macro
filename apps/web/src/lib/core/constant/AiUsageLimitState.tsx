import { isAiDenyCode } from '@app/lib/service-clients/ai-usage-limit';
import type { AiDenyCode } from '@service-auth/ai-billing-types';
import { createSignal } from 'solid-js';

/**
 * Global open state for the AI usage-limit dialog, mirroring `PaywallState`:
 * AI surfaces raise it when the backend answers 402 with one of the
 * billing codes, and the app layout mounts the dialog once.
 */
const [usageLimitOpen, setUsageLimitOpen] = createSignal(false);
const [usageLimitCode, setUsageLimitCode] = createSignal<AiDenyCode | null>(
  null
);

export const useAiUsageLimitState = () => {
  const showUsageLimit = (code?: string) => {
    setUsageLimitCode(isAiDenyCode(code) ? code : 'ai_allowance_exhausted');
    setUsageLimitOpen(true);
  };
  const hideUsageLimit = () => {
    setUsageLimitOpen(false);
    setUsageLimitCode(null);
  };
  return { usageLimitOpen, usageLimitCode, showUsageLimit, hideUsageLimit };
};
