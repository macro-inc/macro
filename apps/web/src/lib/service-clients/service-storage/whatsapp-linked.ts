/** The `/meta/linked` routes of DSS: personal WhatsApp accounts linked as devices. */
import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import type { ObjectLike } from '@core/util/result';
import type { AdoptedGroup } from './generated/schemas/adoptedGroup';
import type { LinkedAccountView } from './generated/schemas/linkedAccountView';
import type { LinkedAdoptGroup } from './generated/schemas/linkedAdoptGroup';
import type { LinkedChats } from './generated/schemas/linkedChats';
import type { LinkedDisconnect } from './generated/schemas/linkedDisconnect';
import type { LinkedFeatures } from './generated/schemas/linkedFeatures';
import type { LinkedPairing } from './generated/schemas/linkedPairing';
import type { LinkedPairState } from './generated/schemas/linkedPairState';
import type { LinkedPasskeyBody } from './generated/schemas/linkedPasskeyBody';
import {
  type WhatsAppErrorCode,
  whatsappErrorResponse,
} from './whatsapp-errors';

const root = `${SERVER_HOSTS['document-storage-service']}/meta/linked`;
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
  configuration: () => fetchWithToken<LinkedFeatures>(`${root}/configuration`),
  account: () => fetchWithToken<LinkedAccountView>(`${root}/account`),
  /** Starts an owner-bound pairing. One account at a time: switching means
   * disconnecting first, so the web never retires a linked identity here. */
  connect: () => post<LinkedPairing>(`${root}/connect`, { replace: false }),
  disconnect: (authorizationGeneration: number) =>
    post<LinkedDisconnect>(`${root}/disconnect`, {
      authorization_generation: authorizationGeneration,
    }),
  /** Pairing material is never cached by the browser. */
  pairing: (id: string) =>
    fetchWithToken<LinkedPairState>(pairing(id), { cache: 'no-store' }),
  cancelPairing: (id: string) =>
    fetchWithToken<Record<string, never>>(pairing(id), { method: 'DELETE' }),
  /** The WebAuthn assertion answering WhatsApp's passkey challenge. */
  passkey: (id: string, response: LinkedPasskeyBody) =>
    post<Record<string, never>>(`${pairing(id)}/passkey`, response),
  /** Every WhatsApp chat, newest activity first; asks DSS for a group refresh. */
  chats: () => fetchWithToken<LinkedChats>(`${root}/chats`),
  adopt: (request: LinkedAdoptGroup) =>
    post<AdoptedGroup>(`${root}/groups/adopt`, request),
};
