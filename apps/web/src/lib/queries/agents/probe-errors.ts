import { ThrownResultError } from '@core/util/result';
import { PROVIDER_CREDENTIAL_REJECTED } from '@service-agent-harness/client';

/** The provider's reconnect instruction, when a probe failed on the caller's credential. */
export function providerCredentialRejectedMessage(
  error: unknown
): string | undefined {
  if (!(error instanceof ThrownResultError)) return;
  return error.errors.find(
    (entry) => entry.code === PROVIDER_CREDENTIAL_REJECTED
  )?.message;
}
