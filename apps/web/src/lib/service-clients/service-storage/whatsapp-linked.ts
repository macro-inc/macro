import type { LinkedAccountView } from './generated/schemas/linkedAccountView';
import type { LinkedAdoptGroup } from './generated/schemas/linkedAdoptGroup';
import type { LinkedBinding } from './generated/schemas/linkedBinding';
import type { LinkedChannelView } from './generated/schemas/linkedChannelView';
import type { LinkedDisconnect } from './generated/schemas/linkedDisconnect';
import type { LinkedFeatures } from './generated/schemas/linkedFeatures';
import type { LinkedGroupInfo } from './generated/schemas/linkedGroupInfo';
import type { LinkedPairing } from './generated/schemas/linkedPairing';
import type { LinkedPairState } from './generated/schemas/linkedPairState';
import type { MetaSendProgress } from './generated/schemas/metaSendProgress';
import type { MetaSendReply } from './generated/schemas/metaSendReply';
import type { MetaUploadedAttachment } from './generated/schemas/metaUploadedAttachment';
import { metaFetch } from './meta-messaging';

const post = (body: unknown) => ({
  method: 'POST' as const,
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
});
const root = '/meta/linked';
const channel = (id: string) => `${root}/channels/${encodeURIComponent(id)}`;
const pairing = (id: string) => `${root}/pairing/${encodeURIComponent(id)}`;
export const whatsappLinkedClient = {
  configuration: () => metaFetch<LinkedFeatures>(`${root}/configuration`),
  account: () => metaFetch<LinkedAccountView>(`${root}/account`),
  connect: (replace = false) =>
    metaFetch<LinkedPairing>(`${root}/connect`, post({ replace })),
  disconnect: (authorization_generation: number) =>
    metaFetch<LinkedDisconnect>(
      `${root}/disconnect`,
      post({ authorization_generation })
    ),
  pair: (id: string) =>
    metaFetch<LinkedPairState>(pairing(id), { cache: 'no-store' }),
  cancel: (id: string) =>
    metaFetch<Record<string, never>>(pairing(id), { method: 'DELETE' }),
  passkey: (id: string, response: unknown) =>
    metaFetch<Record<string, never>>(`${pairing(id)}/passkey`, post(response)),
  confirm: (id: string) =>
    metaFetch<Record<string, never>>(`${pairing(id)}/confirm`, post({})),
  groups: () => metaFetch<LinkedGroupInfo[]>(`${root}/groups`),
  adopt: (request: LinkedAdoptGroup) =>
    metaFetch<LinkedBinding>(`${root}/groups`, post(request)),
  channel: (id: string) => metaFetch<LinkedChannelView>(channel(id)),
  send: (id: string, request: MetaSendReply) =>
    metaFetch<MetaSendProgress>(`${channel(id)}/replies`, post(request)),
  delivery: (id: string, messages: string[]) =>
    metaFetch<MetaSendProgress[]>(`${channel(id)}/delivery`, post(messages)),
  upload: (id: string, file: File) => {
    const body = new FormData();
    body.set('file', file);
    return metaFetch<MetaUploadedAttachment>(`${channel(id)}/attachments`, {
      method: 'POST',
      body,
    });
  },
  grant: (id: string, users: string[]) =>
    metaFetch<Record<string, never>>(`${channel(id)}/access`, post(users)),
  transfer: (id: string, owner: string) =>
    metaFetch<Record<string, never>>(`${channel(id)}/owner`, post(owner)),
  detach: (id: string) =>
    metaFetch<Record<string, never>>(`${channel(id)}/detach`, post({})),
};
