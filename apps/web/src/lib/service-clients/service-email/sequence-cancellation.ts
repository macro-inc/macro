import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { statusError } from '@core/util/safeFetch';
import type { EmptyResponse } from './generated/schemas/emptyResponse';

/** The existing scheduler returns 400 once delivery is claimed or complete. */
export function cancelSequenceDraft(linkId: string, draftId: string) {
  return fetchWithToken<EmptyResponse, 'DELIVERY_STARTED'>(
    `${SERVER_HOSTS['email-service']}/email/drafts/scheduled/${encodeURIComponent(draftId)}`,
    {
      method: 'DELETE',
      headers: { 'X-Email-Link-Id': linkId },
      async errorResponseHandler(response) {
        const failure = statusError(response.status);
        const body: unknown = await response.json().catch(() => undefined);
        const message =
          body &&
          typeof body === 'object' &&
          'message' in body &&
          typeof body.message === 'string'
            ? body.message
            : failure.message;
        if (
          response.status === 400 &&
          /^Message with id [\da-f-]+ is scheduled, processing, or already sent$/i.test(
            message
          )
        )
          return { code: 'DELIVERY_STARTED', message };
        return { ...failure, message };
      },
    }
  );
}
