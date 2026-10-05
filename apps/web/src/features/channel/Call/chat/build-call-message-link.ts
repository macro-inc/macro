import { URL_PARAMS } from '@block-call/constants';
import { buildSimpleEntityUrl } from '@core/util/url';

export function buildCallMessageLink(
  callId: string,
  messageId: string
): string {
  return buildSimpleEntityUrl(
    { type: 'call', id: callId },
    { [URL_PARAMS.messageId]: messageId }
  );
}
