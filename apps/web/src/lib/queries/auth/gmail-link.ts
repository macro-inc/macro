import { authServiceClient, type ConsentScopes } from '@service-auth/client';
import { useMutation } from '@tanstack/solid-query';

/**
 * Mutation that asks auth-service for the Google OAuth authorization URL for
 * adding a Gmail inbox to the already-authenticated user. Callers consume the
 * `authorization_url` and navigate the browser to it. `scopes` selects which
 * permissions the consent screen asks for; only calendar entry points may
 * request calendar access.
 */
export function useInitGmailLink() {
  return useMutation(() => ({
    mutationFn: async (params: {
      originalUrl: string;
      scopes?: ConsentScopes;
    }) => {
      return authServiceClient.initGmailLink(params.originalUrl, {
        scopes: params.scopes,
      });
    },
  }));
}
