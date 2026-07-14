import { authServiceClient } from '@service-auth/client';
import { useMutation } from '@tanstack/solid-query';

/**
 * Mutation for sending a mobile welcome email.
 * Returns the raw `Result` from the client so callers can distinguish
 * between "sent" / "already sent" / rate-limited / invalid-email cases.
 */
export function useSendMobileWelcomeEmail() {
  return useMutation(() => ({
    mutationFn: async (email: string) => {
      return authServiceClient.sendMobileWelcomeEmail(email);
    },
  }));
}
