/** Independent WhatsApp group entity API; no channel endpoints or context. */
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ObjectLike } from '@core/util/result';
import { dssFetch } from './client';
import type {
  LinkedSendProgress,
  LinkedSendReply,
  LinkedUploadedAttachment,
  SharePermissionV2,
  UpdateSharePermissionRequestV2,
  WhatsAppGroupDetail,
  WhatsAppGroupMessages,
  WhatsAppGroupSummary,
} from './generated/schemas';
import {
  type WhatsAppErrorCode,
  whatsappErrorResponse,
} from './whatsapp-errors';

const root = '/meta/linked/whatsapp-groups';
const group = (id: string) => `${root}/${encodeURIComponent(id)}`;

/** Writes keep DSS's error code: a refusal is reported, an unknown outcome retried. */
function write<T extends ObjectLike>(path: string, body: BodyInit) {
  return fetchWithToken<T, WhatsAppErrorCode>(
    `${SERVER_HOSTS['document-storage-service']}${path}`,
    { method: 'POST', body, errorResponseHandler: whatsappErrorResponse }
  );
}
export const whatsappGroupsClient = {
  list: () => dssFetch<WhatsAppGroupSummary[]>(root),
  detail: (id: string) => dssFetch<WhatsAppGroupDetail>(group(id)),
  messages: (id: string, before?: string) => {
    const params = new URLSearchParams({ limit: '50' });
    if (before) params.set('before', before);
    return dssFetch<WhatsAppGroupMessages>(`${group(id)}/messages?${params}`);
  },
  send: (id: string, request: LinkedSendReply) =>
    write<LinkedSendProgress>(`${group(id)}/sends`, JSON.stringify(request)),
  /** The caller's progress for the given send intents. */
  delivery: (id: string, sendIds: string[]) =>
    dssFetch<LinkedSendProgress[]>(`${group(id)}/delivery`, {
      method: 'POST',
      body: JSON.stringify(sendIds),
    }),
  upload: (id: string, file: File) => {
    const body = new FormData();
    body.set('file', file);
    return write<LinkedUploadedAttachment>(`${group(id)}/attachments`, body);
  },
  markRead: (id: string, messageId: string) =>
    dssFetch(`${group(id)}/read`, {
      method: 'POST',
      body: JSON.stringify({ message_id: messageId }),
    }),
  stopSync: (id: string) => dssFetch(group(id), { method: 'DELETE' }),
  permissions: (id: string) =>
    dssFetch<SharePermissionV2>(`${group(id)}/permissions`),
  updatePermissions: (
    id: string,
    permissions: UpdateSharePermissionRequestV2
  ) =>
    dssFetch(`${group(id)}/permissions`, {
      method: 'PATCH',
      body: JSON.stringify(permissions),
    }),
};
