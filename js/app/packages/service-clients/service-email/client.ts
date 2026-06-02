import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { ObjectLike, ResultError } from '@core/util/result';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { Result } from 'neverthrow';
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
  ListEmailFiltersResponse,
  ListLabelsResponse,
  ListLinksResponse,
  ResyncResponse,
  SendMessageRequest,
  SendMessageResponse,
  UpdateLabelBatchRequest,
  UpdateLabelBatchResponse,
  UpdateThreadLabelRequest,
  UpdateThreadLabelsResponse,
  UpsertEmailFilterRequest,
  UpsertEmailFilterResponse,
  UpsertScheduledRequest,
  UpsertScheduledResponse,
} from './generated/schemas';
import type { EmptyResponse } from './generated/schemas/emptyResponse';

const emailHost: string = SERVER_HOSTS['email-service'];

/**
 * Header that scopes a mutating email request to a specific inbox. Omitted for
 * the primary inbox (the backend defaults to it when the header is absent).
 */
const EMAIL_LINK_ID_HEADER = 'X-Email-Link-Id';

function emailLinkHeaders(linkId?: string): Record<string, string> | undefined {
  return linkId ? { [EMAIL_LINK_ID_HEADER]: linkId } : undefined;
}

function emailFetch(
  url: string,
  init?: SafeFetchInit
): Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>>;
function emailFetch<T extends ObjectLike>(
  url: string,
  init?: SafeFetchInit
): Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>;
function emailFetch<T extends ObjectLike = never>(
  url: string,
  init?: SafeFetchInit
):
  | Promise<Result<T, ResultError<FetchWithTokenErrorCode>[]>>
  | Promise<Result<void, ResultError<FetchWithTokenErrorCode>[]>> {
  return fetchWithToken<T>(`${emailHost}${url}`, init);
}

export const emailClient = {
  async init(args?: { linkId?: string }) {
    const path = args?.linkId
      ? `/email/init?link_id=${encodeURIComponent(args.linkId)}`
      : '/email/init';
    return (
      await emailFetch<EmptyResponse>(path, {
        method: 'POST',
      })
    ).map((result) => result);
  },
  async getThread(args: {
    offset?: number;
    limit?: number;
    thread_id: string;
  }) {
    const { offset, limit, thread_id } = args;
    return (
      await emailFetch<GetThreadResponse>(
        `/email/threads/${thread_id}?offset=${offset ?? 0}&limit=${limit ?? 5}`,
        {
          method: 'GET',
        }
      )
    ).map((result) => result);
  },
  async getUserLabels() {
    return (
      await emailFetch<ListLabelsResponse>(`/email/labels`, {
        method: 'GET',
      })
    ).map((result) => result);
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

    return (
      await emailFetch<ApiPaginatedThreadCursor>(
        `/email/threads/previews/cursor/${view}${qp}`,
        {
          method: 'GET',
          ...init,
        }
      )
    ).map((result) => result);
  },
  async updateMessageLabelBatch(args: UpdateLabelBatchRequest) {
    const { message_ids, label_id, value } = args;
    return (
      await emailFetch<UpdateLabelBatchResponse>(`/email/messages/labels`, {
        method: 'PATCH',
        body: JSON.stringify({ value, label_id, message_ids }),
      })
    ).map((result) => result);
  },
  async updateThreadLabel(
    args: { thread_id: string } & UpdateThreadLabelRequest
  ) {
    const { thread_id, label_id, value } = args;
    return (
      await emailFetch<UpdateThreadLabelsResponse>(
        `/email/threads/${thread_id}/labels`,
        {
          method: 'PATCH',
          body: JSON.stringify({ label_id, value }),
        }
      )
    ).map((result) => result);
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
  async flagArchived(args: { value: boolean; id: string }, linkId?: string) {
    const { value, id } = args;
    return (
      await emailFetch<EmptyResponse>(`/email/threads/${id}/archived`, {
        method: 'PATCH',
        body: JSON.stringify({ value }),
        headers: emailLinkHeaders(linkId),
      })
    ).map((result) => result);
  },
  async startSync() {
    return (
      await emailFetch<EmptyResponse>('/email/sync', {
        method: 'POST',
      })
    ).map((result) => result);
  },
  async stopSync() {
    return (
      await emailFetch<EmptyResponse>('/email/sync', {
        method: 'DELETE',
      })
    ).map((result) => result);
  },

  async sendMessage(args: SendMessageRequest, linkId?: string) {
    return (
      await emailFetch<SendMessageResponse>('/email/messages', {
        method: 'POST',
        body: JSON.stringify(args),
        headers: emailLinkHeaders(linkId),
      })
    ).map((result) => result);
  },

  async scheduleMessage(
    args: { draftID: string } & UpsertScheduledRequest,
    linkId?: string
  ) {
    const { draftID, ...rest } = args;
    return (
      await emailFetch<UpsertScheduledResponse>(
        `/email/drafts/scheduled/${draftID}`,
        {
          method: 'PUT',
          body: JSON.stringify(rest),
          headers: emailLinkHeaders(linkId),
        }
      )
    ).map((result) => result);
  },

  async unscheduleMessage(args: { draftID: string }, linkId?: string) {
    return (
      await emailFetch<EmptyResponse>(
        `/email/drafts/scheduled/${args.draftID}`,
        {
          method: 'DELETE',
          headers: emailLinkHeaders(linkId),
        }
      )
    ).map((result) => result);
  },

  async getLinks() {
    return (
      await emailFetch<ListLinksResponse>('/email/links', {
        method: 'GET',
      })
    ).map((result) => result);
  },

  async deleteLink(args: { linkId: string }) {
    const { linkId } = args;
    return (
      await emailFetch<EmptyResponse>(
        `/email/links/${encodeURIComponent(linkId)}`,
        {
          method: 'DELETE',
        }
      )
    ).map((result) => result);
  },

  async resyncLink(args: { linkId: string }) {
    const { linkId } = args;
    return (
      await emailFetch<ResyncResponse>(
        `/email/links/${encodeURIComponent(linkId)}/resync`,
        {
          method: 'POST',
        }
      )
    ).map((result) => result);
  },

  async listContacts() {
    return (
      await emailFetch<ListContactsResponse>('/email/contacts', {
        method: 'GET',
      })
    ).map((result) => result);
  },
  async getAttachmentUrl(args: { id: string }) {
    const { id } = args;
    return (
      await emailFetch<GetAttachmentResponse>(`/email/attachments/${id}`, {
        method: 'GET',
      })
    ).map((result) => result);
  },
  async getOrCreateAttachmentDocumentId(args: { id: string }) {
    const { id } = args;
    return (
      await emailFetch<GetAttachmentDocumentIDResponse>(
        `/email/attachments/${id}/document_id`,
        {
          method: 'GET',
        }
      )
    ).map((result) => result);
  },
  async createDraft(args: CreateDraftRequest, linkId?: string) {
    return (
      await emailFetch<CreateDraftResponse>('/email/drafts', {
        method: 'POST',
        body: JSON.stringify(args),
        headers: emailLinkHeaders(linkId),
      })
    ).map((result) => result);
  },
  async deleteDraft(args: { id: string }, linkId?: string) {
    const { id } = args;
    return (
      await emailFetch<EmptyResponse>(`/email/drafts/${id}`, {
        method: 'DELETE',
        headers: emailLinkHeaders(linkId),
      })
    ).map((result) => result);
  },
  async addDraftAttachment(
    args: {
      draftID: string;
      attachment: AddDraftAttachmentRequest;
    },
    linkId?: string
  ) {
    return (
      await emailFetch<AddDraftAttachmentResponse>(
        `/email/drafts/${args.draftID}/attachments`,
        {
          method: 'POST',
          body: JSON.stringify(args.attachment),
          headers: emailLinkHeaders(linkId),
        }
      )
    ).map((result) => result);
  },
  async removeDraftAttachment(
    args: { draftID: string; attachmentID: string },
    linkId?: string
  ) {
    return (
      await emailFetch<EmptyResponse>(
        `/email/drafts/${args.draftID}/attachments/${args.attachmentID}`,
        {
          method: 'DELETE',
          headers: emailLinkHeaders(linkId),
        }
      )
    ).map((result) => result);
  },
  async addForwardedAttachment(
    args: {
      draftID: string;
      attachmentID: string;
    },
    linkId?: string
  ) {
    return (
      await emailFetch<{
        attachment_id: string;
        filename: string | null;
        mime_type: string | null;
        size_bytes: number | null;
      }>(`/email/drafts/${args.draftID}/forwarded-attachments`, {
        method: 'POST',
        body: JSON.stringify({ attachment_id: args.attachmentID }),
        headers: emailLinkHeaders(linkId),
      })
    ).map((result) => result);
  },
  async removeForwardedAttachment(
    args: {
      draftID: string;
      attachmentID: string;
    },
    linkId?: string
  ) {
    return (
      await emailFetch<EmptyResponse>(
        `/email/drafts/${args.draftID}/forwarded-attachments/${args.attachmentID}`,
        {
          method: 'DELETE',
          headers: emailLinkHeaders(linkId),
        }
      )
    ).map((result) => result);
  },
  async markThreadAsSeen(args: { thread_id: string }, linkId?: string) {
    const { thread_id } = args;
    return (
      await emailFetch<EmptyResponse>(`/email/threads/${thread_id}/seen`, {
        method: 'POST',
        headers: emailLinkHeaders(linkId),
      })
    ).map((result) => result);
  },
  async blockSender(args: { email_address: string }, linkId?: string) {
    return emailFetch('/email/contacts/block', {
      method: 'POST',
      body: JSON.stringify({ email_address: args.email_address }),
      headers: emailLinkHeaders(linkId),
    });
  },
  async unblockSender(args: { email_address: string }, linkId?: string) {
    return emailFetch('/email/contacts/unblock', {
      method: 'POST',
      body: JSON.stringify({ email_address: args.email_address }),
      headers: emailLinkHeaders(linkId),
    });
  },
  async listEmailFilters() {
    return (
      await emailFetch<ListEmailFiltersResponse>('/email/filters', {
        method: 'GET',
      })
    ).map((result) => result);
  },
  async upsertEmailFilter(args: UpsertEmailFilterRequest) {
    return (
      await emailFetch<UpsertEmailFilterResponse>('/email/filters', {
        method: 'PUT',
        body: JSON.stringify(args),
      })
    ).map((result) => result);
  },
  async deleteEmailFilter(args: { id: string }) {
    return emailFetch(`/email/filters/${args.id}`, {
      method: 'DELETE',
    });
  },
};
