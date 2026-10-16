import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ObjectLike } from '@core/util/result';
import type { SafeFetchInit } from '@core/util/safeFetch';
import type { DisconnectResult } from './generated/schemas/disconnectResult';
import type { MetaBeginAuthorization } from './generated/schemas/metaBeginAuthorization';
import type { MetaCompleteAuthorization } from './generated/schemas/metaCompleteAuthorization';
import type { MetaConnection } from './generated/schemas/metaConnection';
import type { MetaConversationResponse } from './generated/schemas/metaConversationResponse';
import type { MetaHistoryImportView } from './generated/schemas/metaHistoryImportView';
import type { MetaProvider } from './generated/schemas/metaProvider';
import type { MetaPublicConfiguration } from './generated/schemas/metaPublicConfiguration';
import type { MetaSendProgress } from './generated/schemas/metaSendProgress';
import type { MetaSendReply } from './generated/schemas/metaSendReply';
import type { MetaTemplate } from './generated/schemas/metaTemplate';
import type { MetaUploadedAttachment } from './generated/schemas/metaUploadedAttachment';

const json = (body: unknown) => ({
  method: 'POST' as const,
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
});

function metaFetch<T extends ObjectLike>(path: string, init?: SafeFetchInit) {
  return fetchWithToken<T>(
    `${SERVER_HOSTS['document-storage-service']}${path}`,
    {
      ...init,
      errorResponseHandler: async (response) => {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = undefined;
        }
        return {
          code: 'HTTP_ERROR' as const,
          message:
            body &&
            typeof body === 'object' &&
            'message' in body &&
            typeof body.message === 'string'
              ? body.message
              : `Customer messaging request failed (${response.status}).`,
        };
      },
    }
  );
}

export const metaMessagingClient = {
  upload: (id: string, file: File) => {
    const body = new FormData();
    body.append('file', file, file.name);
    return metaFetch<MetaUploadedAttachment>(
      `/meta/channels/${encodeURIComponent(id)}/attachments`,
      { method: 'POST', body }
    );
  },
  history: (id: string) =>
    metaFetch<MetaHistoryImportView>(
      `/meta/connections/${encodeURIComponent(id)}/history`
    ),
  importHistory: (id: string) =>
    metaFetch<MetaHistoryImportView>(
      `/meta/connections/${encodeURIComponent(id)}/history`,
      json({})
    ),
  configuration: () =>
    metaFetch<MetaPublicConfiguration>('/meta/configuration'),
  connections: () => metaFetch<MetaConnection[]>('/meta/connections'),
  begin: (provider: MetaProvider, reconnect_id?: string) =>
    metaFetch<MetaBeginAuthorization>(
      '/meta/authorize',
      json({ provider, reconnect_id })
    ),
  complete: (request: MetaCompleteAuthorization) =>
    metaFetch<MetaConnection>('/meta/authorize/complete', json(request)),
  developer: () =>
    metaFetch<MetaConnection>('/meta/developer/whatsapp', json({})),
  disconnect: (id: string) =>
    metaFetch<DisconnectResult>(
      `/meta/connections/${encodeURIComponent(id)}/disconnect`,
      json({})
    ),
  conversation: (id: string) =>
    metaFetch<MetaConversationResponse>(
      `/meta/channels/${encodeURIComponent(id)}`
    ),
  delivery: (id: string, messageIds: string[]) =>
    metaFetch<MetaSendProgress[]>(
      `/meta/channels/${encodeURIComponent(id)}/delivery`,
      json(messageIds)
    ),
  templates: (id: string) =>
    metaFetch<MetaTemplate[]>(
      `/meta/channels/${encodeURIComponent(id)}/templates`
    ),
  reply: (id: string, request: MetaSendReply) =>
    metaFetch<MetaSendProgress>(
      `/meta/channels/${encodeURIComponent(id)}/replies`,
      json(request)
    ),
};
