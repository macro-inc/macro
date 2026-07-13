import { authServiceClient } from '@service-auth/client';
import { useMutation } from '@tanstack/solid-query';

/**
 * Mutation that asks auth-service for the Google OAuth authorization URL for
 * adding a Gmail inbox to the already-authenticated user. Callers consume the
 * `authorization_url` and navigate the browser to it.
 */
export function useInitGmailLink() {
  return useMutation(() => ({
    mutationFn: async (originalUrl: string) => {
      return authServiceClient.initGmailLink(originalUrl);
    },
  }));
}
