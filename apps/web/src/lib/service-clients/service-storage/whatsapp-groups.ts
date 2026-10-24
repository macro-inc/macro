/** Independent WhatsApp group entity API; no channel endpoints or context. */
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

const root = '/meta/linked/whatsapp-groups';
const group = (id: string) => `${root}/${encodeURIComponent(id)}`;
export const whatsappGroupsClient = {
  list: () => dssFetch<WhatsAppGroupSummary[]>(root),
  detail: (id: string) => dssFetch<WhatsAppGroupDetail>(group(id)),
  messages: (id: string, before?: string) => {
    const params = new URLSearchParams({ limit: '50' });
    if (before) params.set('before', before);
    return dssFetch<WhatsAppGroupMessages>(`${group(id)}/messages?${params}`);
  },
  sends: (id: string) => dssFetch<LinkedSendProgress[]>(`${group(id)}/sends`),
  send: (id: string, request: LinkedSendReply) =>
    dssFetch<LinkedSendProgress>(`${group(id)}/sends`, {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  upload: (id: string, file: File) => {
    const body = new FormData();
    body.set('file', file);
    return dssFetch<LinkedUploadedAttachment>(`${group(id)}/attachments`, {
      method: 'POST',
      body,
    });
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
