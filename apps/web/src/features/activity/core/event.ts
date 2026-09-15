import { match } from 'ts-pattern';

export type ActivityAction =
  | { kind: 'created' }
  | { kind: 'edited' }
  | { kind: 'opened' }
  | { kind: 'deleted' }
  | { kind: 'messaged' }
  | { kind: 'email-sent' }
  | { kind: 'call-started' }
  | { kind: 'property-changed'; property: string; from: unknown; to: unknown }
  | { kind: 'participant-added'; participant: string }
  | { kind: 'participant-removed'; participant: string }
  | { kind: 'unknown'; tag: string };

export type ActivityEntityType =
  | 'document'
  | 'project'
  | 'chat'
  | 'email-thread'
  | 'channel'
  | 'user'
  | 'agent-session'
  | { kind: 'unsupported'; raw: string };

export type ActivityEvent = {
  id: string;
  actorId: string;
  entityId: string;
  entityType: ActivityEntityType;
  occurredAt: string;
  action: ActivityAction;
};

export type ActivityTopEntity = {
  entityId: string;
  entityType: ActivityEntityType;
  count: number;
};

export type ActivityOverview = {
  from: string;
  to: string;
  timeZone: string;
  total: number;
  days: Array<{ date: string; count: number }>;
  topEntities: ActivityTopEntity[];
};

export type PropertyEntityType =
  | 'DOCUMENT'
  | 'PROJECT'
  | 'CHAT'
  | 'THREAD'
  | 'CHANNEL'
  | 'USER';

/** Entity kinds the activity UI can resolve a name, icon, and link for. */
export type ActivityDisplayEntityType = PropertyEntityType | 'AGENT_SESSION';

export function toDisplayEntityType(
  entityType: ActivityEntityType
): ActivityDisplayEntityType | undefined {
  return match(entityType)
    .with({ kind: 'unsupported' }, () => undefined)
    .with('document', () => 'DOCUMENT' as const)
    .with('project', () => 'PROJECT' as const)
    .with('chat', () => 'CHAT' as const)
    .with('email-thread', () => 'THREAD' as const)
    .with('channel', () => 'CHANNEL' as const)
    .with('user', () => 'USER' as const)
    .with('agent-session', () => 'AGENT_SESSION' as const)
    .exhaustive();
}
