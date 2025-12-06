import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { mapOk } from '@core/util/maybeResult';
import type { GetUnfurlBulkBody } from './generated/schemas/getUnfurlBulkBody';
import type { GetUnfurlBulkResponse } from './generated/schemas/getUnfurlBulkResponse';
import type { GetUnfurlParams } from './generated/schemas/getUnfurlParams';
import type { GetUnfurlResponse } from './generated/schemas/getUnfurlResponse';

export function proxyResource(url: string) {
  return `${SERVER_HOSTS['unfurl-service']}/proxy?url=${url}`;
}

export const UnfurlServiceClient = {
  async unfurl(args: GetUnfurlParams) {
    return mapOk(
      await fetchWithToken<GetUnfurlResponse>(
        `${SERVER_HOSTS['unfurl-service']}/unfurl?url=${args.url}`
      ),
      (result) => result
    );
  },
  async unfurlBulk(args: GetUnfurlBulkBody) {
    return mapOk(
      await fetchWithToken<GetUnfurlBulkResponse>(
        `${SERVER_HOSTS['unfurl-service']}/unfurl/bulk`,
        {
          method: 'POST',
          body: JSON.stringify(args),
        }
      ),
      (result) => result
    );
  },
};
