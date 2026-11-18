/** DSS's `/whatsapp` routes: personal WhatsApp accounts linked as devices. */
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ObjectLike } from '@core/util/result';
import type { WhatsAppAccountView } from './generated/schemas/whatsAppAccountView';
import type { WhatsAppChats } from './generated/schemas/whatsAppChats';
import type { WhatsAppDisconnect } from './generated/schemas/whatsAppDisconnect';
import type { WhatsAppDisconnectRequest } from './generated/schemas/whatsAppDisconnectRequest';
import type { WhatsAppHistoryImport } from './generated/schemas/whatsAppHistoryImport';
import type { WhatsAppLookup } from './generated/schemas/whatsAppLookup';
import type { WhatsAppLookupRequest } from './generated/schemas/whatsAppLookupRequest';
import type { WhatsAppPairing } from './generated/schemas/whatsAppPairing';
import type { WhatsAppPairState } from './generated/schemas/whatsAppPairState';
import type { WhatsappPasskeyBody } from './generated/schemas/whatsappPasskeyBody';
import {
  type WhatsAppErrorCode,
  whatsappErrorResponse,
} from './whatsapp-errors';

const root = `${SERVER_HOSTS['document-storage-service']}/whatsapp`;
const pairing = (id: string) => `${root}/pairing/${encodeURIComponent(id)}`;

function post<T extends ObjectLike>(url: string, body: unknown) {
  return fetchWithToken<T, WhatsAppErrorCode>(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    errorResponseHandler: whatsappErrorResponse,
  });
}

export const whatsappLinkedClient = {
  account: () => fetchWithToken<WhatsAppAccountView>(`${root}/account`),
  /** Starts an owner-bound pairing. One account at a time: switching means
   * disconnecting first, so the web never retires a linked identity here. */
  connect: () => post<WhatsAppPairing>(`${root}/connect`, { replace: false }),
  disconnect: (authorizationGeneration: number) =>
    post<WhatsAppDisconnect>(`${root}/disconnect`, {
      authorizationGeneration,
    } satisfies WhatsAppDisconnectRequest),
  /** Pairing material is never cached by the browser. */
  pairing: (id: string) =>
    fetchWithToken<WhatsAppPairState>(pairing(id), { cache: 'no-store' }),
  cancelPairing: (id: string) =>
    fetchWithToken<Record<string, never>>(pairing(id), { method: 'DELETE' }),
  /** The WebAuthn assertion answering WhatsApp's passkey challenge. */
  passkey: (id: string, response: WhatsappPasskeyBody) =>
    post<Record<string, never>>(`${pairing(id)}/passkey`, response),
  /** Every WhatsApp chat, newest activity first; asks DSS for a group refresh. */
  chats: () => fetchWithToken<WhatsAppChats>(`${root}/chats`),
  /** Asks whether a number (E.164) has a WhatsApp account, to start a chat. */
  startLookup: (phoneNumber: string) =>
    post<WhatsAppLookup>(`${root}/lookups`, {
      phoneNumber,
    } satisfies WhatsAppLookupRequest),
  /** Imports earlier messages of the caller's chats waiting for their phone. */
  importHistory: () =>
    post<WhatsAppHistoryImport>(`${root}/history-import`, {}),
  /** A lookup's progress; poll it until it isn't `pending`. */
  lookup: (id: string) =>
    fetchWithToken<WhatsAppLookup, WhatsAppErrorCode>(
      `${root}/lookups/${encodeURIComponent(id)}`,
      { cache: 'no-store', errorResponseHandler: whatsappErrorResponse }
    ),
};
