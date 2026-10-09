import { match, P } from 'ts-pattern';

/** Authored references retain groups until the server resolves the current audience. */
export type MessageReferenceKind =
  | 'user'
  | 'bot'
  | 'document'
  | 'form'
  | 'channel'
  | 'thread'
  | 'call'
  | 'calendar_event'
  | 'chat'
  | 'agent_session'
  | 'project'
  | 'static/image'
  | 'static/video'
  | 'group'
  | 'automation'
  | 'crm_company'
  | 'crm_contact';
export type AuthoredMessageReference = {
  entityType: MessageReferenceKind;
  entityId: string;
};
export function messageReference(
  kind: string,
  id: string
): AuthoredMessageReference | undefined {
  if (kind === 'email' || kind === 'email_thread') kind = 'thread';
  // Keep the server's reference wire type while accepting the current UI name.
  if (kind === 'routine') kind = 'automation';
  if (kind === 'user' && id.startsWith('bot|')) kind = 'bot';
  return match(kind)
    .with(
      P.union(
        'user',
        'bot',
        'document',
        'form',
        'channel',
        'thread',
        'call',
        'calendar_event',
        'chat',
        'agent_session',
        'project',
        'static/image',
        'static/video',
        'group',
        'automation',
        'crm_company',
        'crm_contact'
      ),
      (entityType) => ({ entityType, entityId: id })
    )
    .with(P._, () => undefined)
    .exhaustive();
}
