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
import type {
  CreateDraftRequest,
  CreateDraftResponse,
  GetAttachmentResponse,
  GetPreviewsCursorResponse,
  GetThreadResponse,
  ListContactsResponse,
  ListLabelsResponse,
  ListLinksResponse,
  SendMessageRequest,
  SendMessageResponse,
  UpdateLabelBatchRequest,
  UpdateLabelBatchResponse,
} from './generated/schemas';
import type { EmptyResponse } from './generated/schemas/emptyResponse';

const emailHost: string = SERVER_HOSTS['email-service'];

export function emailFetch(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeError<FetchWithTokenErrorCode>>;
export function emailFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<MaybeResult<FetchWithTokenErrorCode, T>>;
export function emailFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<MaybeResult<FetchWithTokenErrorCode, T>>
  | Promise<MaybeError<FetchWithTokenErrorCode>> {
  return fetchWithToken<T>(`${emailHost}${url}`, init);
}

export const emailClient = {
  async init() {
    return mapOk(
      await emailFetch<EmptyResponse>('/email/init', {
        method: 'POST',
      }),
      (result) => result
    );
  },
  async getThread(args: {
    offset?: number;
    limit?: number;
    thread_id: string;
  }) {
    const { offset, limit, thread_id } = args;
    return mapOk(
      await emailFetch<GetThreadResponse>(
        `/email/threads/${thread_id}?offset=${offset ?? 0}&limit=${limit ?? 5}`,
        {
          method: 'GET',
        }
      ),
      (result) => result
    );
  },
  async getUserLabels() {
    return mapOk(
      await emailFetch<ListLabelsResponse>(`/email/labels`, {
        method: 'GET',
      }),
      (result) => result
    );
  },
  async getPreviews(args: {
    view: string;
    limit: number;
    sort_method: string;
    cursor?: string;
  }) {
    const { view, ...params } = args;
    const p = Object.entries(params)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const qp = p.length > 0 ? '?' + p : p;

    return mapOk(
      await emailFetch<GetPreviewsCursorResponse>(
        `/email/threads/previews/cursor/${view}${qp}`,
        {
          method: 'GET',
        }
      ),
      (result) => result
    );
  },
  async updateMessageLabelBatch(args: UpdateLabelBatchRequest) {
    const { message_ids, label_id, value } = args;
    return mapOk(
      await emailFetch<UpdateLabelBatchResponse>(`/email/messages/labels`, {
        method: 'PATCH',
        body: JSON.stringify({ value, label_id, message_ids }),
      }),
      (result) => result
    );
  },
  async flagArchived(args: { value: boolean; id: string }) {
    const { value, id } = args;
    return mapOk(
      await emailFetch<EmptyResponse>(`/email/threads/${id}/archived`, {
        method: 'PATCH',
        body: JSON.stringify({ value }),
      }),
      (result) => result
    );
  },
  async startSync() {
    return mapOk(
      await emailFetch<EmptyResponse>('/email/sync', {
        method: 'POST',
      }),
      (result) => result
    );
  },
  async stopSync() {
    return mapOk(
      await emailFetch<EmptyResponse>('/email/sync', {
        method: 'DELETE',
      }),
      (result) => result
    );
  },

  async sendMessage(args: SendMessageRequest) {
    return mapOk(
      await emailFetch<SendMessageResponse>('/email/messages', {
        method: 'POST',
        body: JSON.stringify(args),
      }),
      (result) => result
    );
  },

  async getLinks() {
    return mapOk(
      await emailFetch<ListLinksResponse>('/email/links', {
        method: 'GET',
      }),
      (result) => result
    );
  },

  async listContacts() {
    return mapOk(
      await emailFetch<ListContactsResponse>('/email/contacts', {
        method: 'GET',
      }),
      (result) => result
    );
  },
  async getAttachmentUrl(args: { id: string }) {
    const { id } = args;
    return mapOk(
      await emailFetch<GetAttachmentResponse>(`/email/attachments/${id}`, {
        method: 'GET',
      }),
      (result) => result
    );
  },
  async createDraft(args: CreateDraftRequest) {
    return mapOk(
      await emailFetch<CreateDraftResponse>('/email/drafts', {
        method: 'POST',
        body: JSON.stringify(args),
      }),
      (result) => result
    );
  },
  async deleteDraft(args: { id: string }) {
    const { id } = args;
    return mapOk(
      await emailFetch<EmptyResponse>(`/email/drafts/${id}`, {
        method: 'DELETE',
      }),
      (result) => result
    );
  },
  async markThreadAsSeen(args: { thread_id: string }) {
    const { thread_id } = args;
    return mapOk(
      await emailFetch<EmptyResponse>(`/email/threads/${thread_id}/seen`, {
        method: 'POST',
      }),
      (result) => result
    );
  },
};
