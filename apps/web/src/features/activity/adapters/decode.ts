import type {
  ActivityEventFieldsFragment,
  GraphqlEntityType,
  MyActivityOverviewQuery,
} from '@service-storage/graphql/generated/graphql';
import type {
  ActivityAction,
  ActivityEntityType,
  ActivityEvent,
  ActivityOverview,
} from '../domain/event';

export function decodeActivityEvent(
  fragment: ActivityEventFieldsFragment
): ActivityEvent {
  return {
    id: fragment.id,
    actorId: fragment.actorId,
    entityId: fragment.entityId,
    entityType: decodeEntityType(fragment.entityType),
    occurredAt: fragment.occurredAt,
    action: decodeAction(fragment.action),
  };
}

export function decodeActivityOverview(
  overview: MyActivityOverviewQuery['user']['activityOverview']
): ActivityOverview {
  return {
    from: overview.from,
    to: overview.to,
    timeZone: overview.timeZone,
    total: overview.total,
    days: overview.days.map((day) => ({ date: day.date, count: day.count })),
    topEntities: overview.topEntities.map((entity) => ({
      entityId: entity.entityId,
      entityType: decodeEntityType(entity.entityType),
      count: entity.count,
    })),
  };
}

export function decodeEntityType(
  entityType: GraphqlEntityType
): ActivityEntityType {
  switch (entityType) {
    case 'DOCUMENT':
      return 'document';
    case 'PROJECT':
      return 'project';
    case 'CHAT':
      return 'chat';
    case 'EMAIL_THREAD':
      return 'email-thread';
    case 'CHANNEL':
      return 'channel';
    case 'USER':
      return 'user';
    default:
      return { kind: 'unsupported', raw: entityType };
  }
}

function decodeAction(
  action: ActivityEventFieldsFragment['action']
): ActivityAction {
  switch (action.__typename) {
    case 'GraphqlActivityCreated':
      return { kind: 'created' };
    case 'GraphqlActivityEdited':
      return { kind: 'edited' };
    case 'GraphqlActivityOpened':
      return { kind: 'opened' };
    case 'GraphqlActivityDeleted':
      return { kind: 'deleted' };
    case 'GraphqlActivityMessaged':
      return { kind: 'messaged' };
    case 'GraphqlActivitySent':
      return { kind: 'email-sent' };
    case 'GraphqlActivityCallStarted':
      return { kind: 'call-started' };
    case 'GraphqlActivityPropertyChanged':
      return {
        kind: 'property-changed',
        property: action.property,
        from: action.from,
        to: action.to,
      };
    case 'GraphqlActivityParticipantAdded':
      return { kind: 'participant-added', participant: action.participant };
    case 'GraphqlActivityParticipantRemoved':
      return { kind: 'participant-removed', participant: action.participant };
    case 'GraphqlActivityUnknownAction':
      return { kind: 'unknown', tag: action.tag };
    default: {
      const unexpected = action as { __typename?: string };
      return {
        kind: 'unknown',
        tag: unexpected.__typename ?? 'unknown',
      };
    }
  }
}
