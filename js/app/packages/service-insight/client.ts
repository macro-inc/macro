import { SERVER_HOSTS } from '@core/constant/servers';
import { cache } from '@core/util/cache';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import {
  type MaybeError,
  type MaybeResult,
  mapOk,
  type ObjectLike,
} from '@core/util/maybeResult';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { CreateInsightsRequest } from './generated/schemas/createInsightsRequest';
import type { GetUserInsightsResponse } from './generated/schemas/getUserInsightsResponse';
import type { HandleGetUserInsightsParams } from './generated/schemas/handleGetUserInsightsParams';
import type { IdList } from './generated/schemas/idList';
import type { UpdateInsightRequest } from './generated/schemas/updateInsightRequest';
import type { UserInsightRecord } from './generated/schemas/userInsightRecord';

const insightHost = SERVER_HOSTS['insight-service'];

const USER_INSIGHTS_CACHE_EXPIRY_MINS = 180; // 3 hours

export function insightFetch(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeError<FetchWithTokenErrorCode>>;
export function insightFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeResult<FetchWithTokenErrorCode, T>>;
export function insightFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<MaybeResult<FetchWithTokenErrorCode, T>>
  | Promise<MaybeError<FetchWithTokenErrorCode>> {
  return fetchWithToken<T>(`${insightHost}${url}`, init);
}

export const insightClient = {
  async createUserInsight(args: CreateInsightsRequest) {
    const result = await insightFetch<IdList>('/user_insight', {
      method: 'POST',
      body: JSON.stringify(args),
    });

    insightClient.getUserInsight.invalidate({ limit: 100, offset: 0 });
    return result;
  },
  getUserInsight: cache(
    async function getUserInsight(args: HandleGetUserInsightsParams) {
      let queryString = Object.entries(args)
        .map(([k, v]) => {
          return `${k}=${v}`;
        })
        .join('&');

      return mapOk(
        await insightFetch<GetUserInsightsResponse>(
          `/user_insight?${queryString}`
        ),
        (data) => {
          if (!data.insights || data.insights.length === 0) {
            insightClient.getUserInsight.invalidate(args);
          }
          return data;
        }
      );
    },
    { minutes: USER_INSIGHTS_CACHE_EXPIRY_MINS }
  ),
  async updateUserInsight(args: UpdateInsightRequest) {
    const result = await insightFetch<UserInsightRecord>(`/user_insight`, {
      method: 'PATCH',
      body: JSON.stringify(args),
    });

    insightClient.getUserInsight.invalidate({ limit: 100, offset: 0 });
    return result;
  },
  async deleteUserInsights(args: IdList) {
    const result = await insightFetch<IdList>(`/user_insight`, {
      method: 'DELETE',
      body: JSON.stringify(args),
    });

    return result;
  },
};
