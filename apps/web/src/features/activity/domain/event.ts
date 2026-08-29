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

export function toPropertyEntityType(
  entityType: ActivityEntityType
): PropertyEntityType | undefined {
  if (typeof entityType === 'object') return undefined;
  switch (entityType) {
    case 'document':
      return 'DOCUMENT';
    case 'project':
      return 'PROJECT';
    case 'chat':
      return 'CHAT';
    case 'email-thread':
      return 'THREAD';
    case 'channel':
      return 'CHANNEL';
    case 'user':
      return 'USER';
  }
}
