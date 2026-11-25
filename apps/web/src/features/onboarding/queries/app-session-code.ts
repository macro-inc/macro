import { Telemetry } from '@macro-inc/observability';
import { authServiceClient } from '@service-auth/client';
import type { AppHandoff } from '../core/app-handoff';

/**
 * Mints the session code that signs the native app in. The span records the
 * handoff id, which the app's own spans carry too, and never the code or the
 * challenge.
 */
export function mintAppSessionCode(
  handoff: AppHandoff
): Promise<string | undefined> {
  return Telemetry.span('auth.app_handoff.mint', async (span) => {
    span.setAttr('auth.app_handoff.id', handoff.handoffId);
    const result = await authServiceClient.sessionCreation({
      challenge: handoff.challenge,
    });
    span.setAttr(
      'auth.app_handoff.outcome',
      result.isOk() ? 'minted' : 'failed'
    );
    if (result.isErr()) {
      console.error('Failed to mint the app session code', result.error);
      return undefined;
    }
    return result.value.sessionCode;
  });
}
