import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { AppErrorResult, AppResult, ObjectLike } from '@core/util/result';

import type { SafeFetchInit } from '@core/util/safeFetch';

const contactsHost = `${SERVER_HOSTS['contacts']}`;

import type { GetContactsResponse } from './generated/schemas/getContactsResponse';

export function contactsFetch(
  url: string,
  init?: SafeFetchInit
): Promise<AppErrorResult<FetchWithTokenErrorCode>>;
export function contactsFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<AppResult<FetchWithTokenErrorCode, T>>;
export function contactsFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<AppResult<FetchWithTokenErrorCode, T>>
  | Promise<AppErrorResult<FetchWithTokenErrorCode>> {
  return fetchWithToken<T>(`${contactsHost}${url}`, init);
}

export const contactsClient = {
  async getContacts() {
    return (
      await contactsFetch<GetContactsResponse>(`/contacts`, {
        method: 'GET',
      })
    ).map((result) => result);
  },
  async addContact(userId: string) {
    return contactsFetch(`/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
  },
};
