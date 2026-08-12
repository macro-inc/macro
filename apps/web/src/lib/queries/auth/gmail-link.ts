import { authServiceClient } from '@service-auth/client';
import { useMutation } from '@tanstack/solid-query';

/**
 * Mutation that asks auth-service for the Google OAuth authorization URL for
 * adding a Gmail inbox to the already-authenticated user. Callers consume the
 * `authorization_url` and navigate the browser to it. `includeCalendar` adds
 * the Google Calendar scope to the consent request; only calendar entry
 * points should pass it.
 */
export function useInitGmailLink() {
  return useMutation(() => ({
    mutationFn: async (params: {
      originalUrl: string;
      includeCalendar?: boolean;
    }) => {
      return authServiceClient.initGmailLink(params.originalUrl, {
        includeCalendar: params.includeCalendar,
      });
    },
  }));
}
