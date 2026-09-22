import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';

import type { GetUnfurlBulkBody } from './generated/schemas/getUnfurlBulkBody';
import type { GetUnfurlBulkResponse } from './generated/schemas/getUnfurlBulkResponse';
import type { GetUnfurlParams } from './generated/schemas/getUnfurlParams';
import type { GetUnfurlResponse } from './generated/schemas/getUnfurlResponse';

export function proxyResource(url: string) {
  // Encode so query strings in the proxied URL don't leak into /proxy's own
  // params (og:image URLs frequently carry `&`-separated params).
  return `${SERVER_HOSTS['unfurl-service']}/proxy?url=${encodeURIComponent(url)}`;
}

export const UnfurlServiceClient = {
  async unfurl(args: GetUnfurlParams) {
    return (
      await fetchWithToken<GetUnfurlResponse>(
        `${SERVER_HOSTS['unfurl-service']}/unfurl?url=${args.url}`
      )
    ).map((result) => result);
  },
  async unfurlBulk(args: GetUnfurlBulkBody) {
    return (
      await fetchWithToken<GetUnfurlBulkResponse>(
        `${SERVER_HOSTS['unfurl-service']}/unfurl/bulk`,
        {
          method: 'POST',
          body: JSON.stringify(args),
        }
      )
    ).map((result) => result);
  },
};
