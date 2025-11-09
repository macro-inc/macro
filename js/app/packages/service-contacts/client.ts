import { SERVER_HOSTS } from '@core/constant/servers';
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

const contactsHost = `${SERVER_HOSTS['contacts']}`;

import type { GetContactsResponse } from './generated/schemas/getContactsResponse';

export function contactsFetch(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeError<FetchWithTokenErrorCode>>;
export function contactsFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeResult<FetchWithTokenErrorCode, T>>;
export function contactsFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<MaybeResult<FetchWithTokenErrorCode, T>>
  | Promise<MaybeError<FetchWithTokenErrorCode>> {
  return fetchWithToken<T>(`${contactsHost}${url}`, init);
}

export const contactsClient = {
  async getContacts() {
    return mapOk(
      await contactsFetch<GetContactsResponse>(`/contacts`, {
        method: 'GET',
      }),
      (result) => result
    );
  },
};
