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
  AddDraftAttachmentRequest,
  AddDraftAttachmentResponse,
  ApiPaginatedThreadCursor,
  CreateDraftRequest,
  CreateDraftResponse,
  GetAttachmentDocumentIDResponse,
  GetAttachmentResponse,
  GetThreadResponse,
  ListContactsResponse,
  ListLabelsResponse,
  ListLinksResponse,
  SendMessageRequest,
  SendMessageResponse,
  UpdateLabelBatchRequest,
  UpdateLabelBatchResponse,
  UpdateThreadLabelRequest,
  UpdateThreadLabelsResponse,
  UpsertScheduledRequest,
  UpsertScheduledResponse,
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
  async getPreviews(
    args: {
      view: string;
      limit?: number;
      sort_method?: string;
      cursor?: string;
    },
    init?: SafeFetchInit
  ) {
    const { view, ...params } = args;
    const p = Object.entries(params)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const qp = p.length > 0 ? '?' + p : '';

    return mapOk(
      await emailFetch<ApiPaginatedThreadCursor>(
        `/email/threads/previews/cursor/${view}${qp}`,
        {
          method: 'GET',
          ...init,
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
  async updateThreadLabel(
    args: { thread_id: string } & UpdateThreadLabelRequest
  ) {
    const { thread_id, label_id, value } = args;
    return mapOk(
      await emailFetch<UpdateThreadLabelsResponse>(
        `/email/threads/${thread_id}/labels`,
        {
          method: 'PATCH',
          body: JSON.stringify({ label_id, value }),
        }
      ),
      (result) => result
    );
  },
  async updateThreadProject(args: {
    thread_id: string;
    projectId: string | null;
  }) {
    const { thread_id, projectId } = args;
    return emailFetch<{ oldProjectId: string | null }>(
      `/email/threads/${thread_id}/project`,
      {
        method: 'PATCH',
        body: JSON.stringify({ projectId }),
      }
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

  async scheduleMessage(args: { draftID: string } & UpsertScheduledRequest) {
    const { draftID, ...rest } = args;
    return mapOk(
      await emailFetch<UpsertScheduledResponse>(
        `/email/drafts/scheduled/${draftID}`,
        {
          method: 'PUT',
          body: JSON.stringify(rest),
        }
      ),
      (result) => result
    );
  },

  async unscheduleMessage(args: { draftID: string }) {
    return mapOk(
      await emailFetch<EmptyResponse>(
        `/email/drafts/scheduled/${args.draftID}`,
        {
          method: 'DELETE',
        }
      ),
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
  async getOrCreateAttachmentDocumentId(args: { id: string }) {
    const { id } = args;
    return mapOk(
      await emailFetch<GetAttachmentDocumentIDResponse>(
        `/email/attachments/${id}/document_id`,
        {
          method: 'GET',
        }
      ),
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
  async addDraftAttachment(args: {
    draftID: string;
    attachment: AddDraftAttachmentRequest;
  }) {
    return mapOk(
      await emailFetch<AddDraftAttachmentResponse>(
        `/email/drafts/${args.draftID}/attachments`,
        {
          method: 'POST',
          body: JSON.stringify(args.attachment),
        }
      ),
      (result) => result
    );
  },
  async removeDraftAttachment(args: { draftID: string; attachmentID: string }) {
    return mapOk(
      await emailFetch<EmptyResponse>(
        `/email/drafts/${args.draftID}/attachments/${args.attachmentID}`,
        {
          method: 'DELETE',
        }
      ),
      (result) => result
    );
  },
  async addForwardedAttachment(args: {
    draftID: string;
    attachmentID: string;
  }) {
    return mapOk(
      await emailFetch<{
        attachment_id: string;
        filename: string | null;
        mime_type: string | null;
        size_bytes: number | null;
      }>(`/email/drafts/${args.draftID}/forwarded-attachments`, {
        method: 'POST',
        body: JSON.stringify({ attachment_id: args.attachmentID }),
      }),
      (result) => result
    );
  },
  async removeForwardedAttachment(args: {
    draftID: string;
    attachmentID: string;
  }) {
    return mapOk(
      await emailFetch<EmptyResponse>(
        `/email/drafts/${args.draftID}/forwarded-attachments/${args.attachmentID}`,
        {
          method: 'DELETE',
        }
      ),
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
