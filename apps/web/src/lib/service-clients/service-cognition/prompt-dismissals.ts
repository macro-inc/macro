/**
 * Client for dismissed sidebar prompts on the document cognition service
 * (the onboarding crate's `/onboarding/prompts` routes).
 */
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { DismissedPrompts } from './generated/schemas/dismissedPrompts';

export type { DismissedPrompts };

const dcsHost: string = SERVER_HOSTS['cognition-service'];

export const promptDismissalsClient = {
  /** The prompts the user dismissed on any device. */
  async list() {
    return await fetchWithToken<DismissedPrompts>(
      `${dcsHost}/onboarding/prompts`,
      { method: 'GET' }
    );
  },

  /** Dismiss one prompt everywhere (idempotent). */
  async dismiss(promptId: string) {
    return await fetchWithToken(
      `${dcsHost}/onboarding/prompts/${encodeURIComponent(promptId)}/dismiss`,
      { method: 'POST' }
    );
  },
};
