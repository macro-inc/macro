/** DSS's `/external-chats` routes: added chats from any provider, apart from channels. */
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ObjectLike } from '@core/util/result';
import { dssFetch } from './client';
import type {
  ExternalChatAdd,
  ExternalChatAdded,
  ExternalChatDetail,
  ExternalChatMessages,
  ExternalChatSendProgress,
  ExternalChatSendReply,
  ExternalChatSummary,
  ExternalChatUploadedAttachment,
  MarkRead,
  SharePermissionV2,
  UpdateSharePermissionRequestV2,
} from './generated/schemas';
import {
  type WhatsAppErrorCode,
  whatsappErrorResponse,
} from './whatsapp-errors';

const root = '/external-chats';
const chat = (id: string) => `${root}/${encodeURIComponent(id)}`;

/** Writes keep DSS's error code: a refusal is reported, an unknown outcome retried. */
function write<T extends ObjectLike>(path: string, body: BodyInit) {
  return fetchWithToken<T, WhatsAppErrorCode>(
    `${SERVER_HOSTS['document-storage-service']}${path}`,
    { method: 'POST', body, errorResponseHandler: whatsappErrorResponse }
  );
}
export const externalChatsClient = {
  list: () => dssFetch<ExternalChatSummary[]>(root),
  /** Adds one of the caller's provider chats to Macro. */
  add: (request: ExternalChatAdd) =>
    write<ExternalChatAdded>(root, JSON.stringify(request)),
  detail: (id: string) => dssFetch<ExternalChatDetail>(chat(id)),
  messages: (id: string, before?: string) => {
    const params = new URLSearchParams({ limit: '50' });
    if (before) params.set('before', before);
    return dssFetch<ExternalChatMessages>(`${chat(id)}/messages?${params}`);
  },
  send: (id: string, request: ExternalChatSendReply) =>
    write<ExternalChatSendProgress>(
      `${chat(id)}/sends`,
      JSON.stringify(request)
    ),
  /** The caller's progress for the given send intents. */
  delivery: (id: string, sendIds: string[]) =>
    dssFetch<ExternalChatSendProgress[]>(`${chat(id)}/delivery`, {
      method: 'POST',
      body: JSON.stringify(sendIds),
    }),
  upload: (id: string, file: File) => {
    const body = new FormData();
    body.set('file', file);
    return write<ExternalChatUploadedAttachment>(
      `${chat(id)}/attachments`,
      body
    );
  },
  markRead: (id: string, messageId: string) =>
    dssFetch(`${chat(id)}/read`, {
      method: 'POST',
      body: JSON.stringify({ messageId } satisfies MarkRead),
    }),
  stopSync: (id: string) => dssFetch(chat(id), { method: 'DELETE' }),
  permissions: (id: string) =>
    dssFetch<SharePermissionV2>(`${chat(id)}/permissions`),
  updatePermissions: (
    id: string,
    permissions: UpdateSharePermissionRequestV2
  ) =>
    dssFetch(`${chat(id)}/permissions`, {
      method: 'PATCH',
      body: JSON.stringify(permissions),
    }),
};
