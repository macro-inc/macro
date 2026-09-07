/** Authored references retain groups until the server resolves the current audience. */
export type MessageReferenceKind =
  | 'user'
  | 'bot'
  | 'document'
  | 'channel'
  | 'thread'
  | 'call'
  | 'calendar_event'
  | 'chat'
  | 'project'
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
  if (kind === 'user' && id.startsWith('bot|')) kind = 'bot';
  switch (kind) {
    case 'user':
    case 'bot':
    case 'document':
    case 'channel':
    case 'thread':
    case 'call':
    case 'calendar_event':
    case 'chat':
    case 'project':
    case 'group':
    case 'automation':
    case 'crm_company':
    case 'crm_contact':
      return { entityType: kind, entityId: id };
    default:
      return undefined;
  }
}
