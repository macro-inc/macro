import type { ActivityEventFieldsFragment } from '@service-storage/graphql/generated/graphql';

const BASE = {
  __typename: 'GraphqlActivityEvent' as const,
  id: 'evt-1',
  actorId: 'macro|sarah@example.com',
  subjectId: 'macro|sarah@example.com',
  entityType: 'DOCUMENT' as const,
  entityId: 'doc-1',
  occurredAt: '2026-08-21T12:00:00.000Z',
};

export const createdEvent: ActivityEventFieldsFragment = {
  ...BASE,
  action: { __typename: 'GraphqlActivityCreated' },
};

export const editedEvent: ActivityEventFieldsFragment = {
  ...BASE,
  id: 'evt-2',
  action: { __typename: 'GraphqlActivityEdited' },
};

export const openedEvent: ActivityEventFieldsFragment = {
  ...BASE,
  id: 'evt-3',
  action: { __typename: 'GraphqlActivityOpened' },
};

export const deletedEvent: ActivityEventFieldsFragment = {
  ...BASE,
  id: 'evt-4',
  action: { __typename: 'GraphqlActivityDeleted' },
};

export const messagedEvent: ActivityEventFieldsFragment = {
  ...BASE,
  id: 'evt-5',
  entityType: 'CHANNEL',
  entityId: 'channel-1',
  action: { __typename: 'GraphqlActivityMessaged' },
};

export const sentEvent: ActivityEventFieldsFragment = {
  ...BASE,
  id: 'evt-6',
  entityType: 'EMAIL_THREAD',
  entityId: 'thread-1',
  action: { __typename: 'GraphqlActivitySent' },
};

export const propertyChangedEvent: ActivityEventFieldsFragment = {
  ...BASE,
  id: 'evt-7',
  action: {
    __typename: 'GraphqlActivityPropertyChanged',
    property: 'prop-1',
    from: null,
    to: 'Done',
  },
};

export const participantAddedEvent: ActivityEventFieldsFragment = {
  ...BASE,
  id: 'evt-8',
  entityType: 'CHANNEL',
  entityId: 'channel-1',
  action: {
    __typename: 'GraphqlActivityParticipantAdded',
    participant: 'macro|sarah@example.com',
  },
};

export const participantRemovedEvent: ActivityEventFieldsFragment = {
  ...BASE,
  id: 'evt-9',
  entityType: 'CHANNEL',
  entityId: 'channel-1',
  action: {
    __typename: 'GraphqlActivityParticipantRemoved',
    participant: 'macro|sarah@example.com',
  },
};

export const callStartedEvent: ActivityEventFieldsFragment = {
  ...BASE,
  id: 'evt-10',
  entityType: 'CHANNEL',
  entityId: 'channel-1',
  action: {
    __typename: 'GraphqlActivityCallStarted',
    callId: 'call-1',
  },
};

export const unknownActionEvent: ActivityEventFieldsFragment = {
  ...BASE,
  id: 'evt-11',
  action: {
    __typename: 'GraphqlActivityUnknownAction',
    tag: 'transmogrified_thoroughly',
    payload: null,
  },
};

export const unsupportedEntityEvent: ActivityEventFieldsFragment = {
  ...BASE,
  id: 'evt-12',
  entityType: 'TEAM',
  entityId: 'team-1',
  action: { __typename: 'GraphqlActivityCreated' },
};
