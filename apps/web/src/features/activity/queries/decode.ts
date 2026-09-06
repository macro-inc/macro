import type {
  ActivityEventFieldsFragment,
  GraphqlEntityType,
  MyActivityOverviewQuery,
} from '@service-storage/graphql/generated/graphql';
import { match } from 'ts-pattern';
import type {
  ActivityAction,
  ActivityEntityType,
  ActivityEvent,
  ActivityOverview,
} from '../core/event';

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
  return match(entityType)
    .with('DOCUMENT', () => 'document' as const)
    .with('PROJECT', () => 'project' as const)
    .with('CHAT', () => 'chat' as const)
    .with('EMAIL_THREAD', () => 'email-thread' as const)
    .with('CHANNEL', () => 'channel' as const)
    .with('USER', () => 'user' as const)
    .otherwise((raw) => ({ kind: 'unsupported' as const, raw }));
}

function decodeAction(
  action: ActivityEventFieldsFragment['action']
): ActivityAction {
  return match(action)
    .with({ __typename: 'GraphqlActivityCreated' }, () => ({
      kind: 'created' as const,
    }))
    .with({ __typename: 'GraphqlActivityEdited' }, () => ({
      kind: 'edited' as const,
    }))
    .with({ __typename: 'GraphqlActivityOpened' }, () => ({
      kind: 'opened' as const,
    }))
    .with({ __typename: 'GraphqlActivityDeleted' }, () => ({
      kind: 'deleted' as const,
    }))
    .with({ __typename: 'GraphqlActivityMessaged' }, () => ({
      kind: 'messaged' as const,
    }))
    .with({ __typename: 'GraphqlActivitySent' }, () => ({
      kind: 'email-sent' as const,
    }))
    .with({ __typename: 'GraphqlActivityCallStarted' }, () => ({
      kind: 'call-started' as const,
    }))
    .with(
      { __typename: 'GraphqlActivityPropertyChanged' },
      ({ property, from, to }) => ({
        kind: 'property-changed' as const,
        property,
        from,
        to,
      })
    )
    .with(
      { __typename: 'GraphqlActivityParticipantAdded' },
      ({ participant }) => ({
        kind: 'participant-added' as const,
        participant,
      })
    )
    .with(
      { __typename: 'GraphqlActivityParticipantRemoved' },
      ({ participant }) => ({
        kind: 'participant-removed' as const,
        participant,
      })
    )
    .with({ __typename: 'GraphqlActivityUnknownAction' }, ({ tag }) => ({
      kind: 'unknown' as const,
      tag,
    }))
    .otherwise((unexpected) => ({
      kind: 'unknown' as const,
      tag: (unexpected as { __typename?: string }).__typename ?? 'unknown',
    }));
}
