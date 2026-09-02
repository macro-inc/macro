import { describe, expect, it } from 'vitest';
import { decodeActivityEvent } from './decode';
import {
  callStartedEvent,
  createdEvent,
  deletedEvent,
  editedEvent,
  messagedEvent,
  openedEvent,
  participantAddedEvent,
  participantRemovedEvent,
  propertyChangedEvent,
  sentEvent,
  unknownActionEvent,
  unsupportedEntityEvent,
} from './fixtures';

describe('decodeActivityEvent', () => {
  it.each([
    [createdEvent, { kind: 'created' as const }],
    [editedEvent, { kind: 'edited' as const }],
    [openedEvent, { kind: 'opened' as const }],
    [deletedEvent, { kind: 'deleted' as const }],
    [messagedEvent, { kind: 'messaged' as const }],
    [sentEvent, { kind: 'email-sent' as const }],
    [callStartedEvent, { kind: 'call-started' as const }],
    [
      propertyChangedEvent,
      {
        kind: 'property-changed' as const,
        property: 'prop-1',
        from: null,
        to: 'Done',
      },
    ],
    [
      participantAddedEvent,
      {
        kind: 'participant-added' as const,
        participant: 'macro|sarah@example.com',
      },
    ],
    [
      participantRemovedEvent,
      {
        kind: 'participant-removed' as const,
        participant: 'macro|sarah@example.com',
      },
    ],
  ] as const)('decodes $0.id', (fragment, action) => {
    expect(decodeActivityEvent(fragment).action).toEqual(action);
  });

  it('maps supported entity types onto the owned vocabulary', () => {
    expect(decodeActivityEvent(createdEvent).entityType).toBe('document');
    expect(decodeActivityEvent(messagedEvent).entityType).toBe('channel');
    expect(decodeActivityEvent(sentEvent).entityType).toBe('email-thread');
  });

  it('keeps the unknown-action tag so describeAction can humanize it', () => {
    expect(decodeActivityEvent(unknownActionEvent)).toEqual({
      id: 'evt-11',
      actorId: 'macro|sarah@example.com',
      entityId: 'doc-1',
      entityType: 'document',
      occurredAt: '2026-08-21T12:00:00.000Z',
      action: { kind: 'unknown', tag: 'transmogrified_thoroughly' },
    });
  });

  it('does not leak an unsupported entity as a reference type', () => {
    expect(decodeActivityEvent(unsupportedEntityEvent).entityType).toEqual({
      kind: 'unsupported',
      raw: 'TEAM',
    });
  });

  it('never drops a row when the action typename is unrecognized', () => {
    const fragment = {
      ...createdEvent,
      action: { __typename: 'GraphqlActivityTimeTravelled' },
    } as unknown as typeof createdEvent;

    expect(decodeActivityEvent(fragment).action).toEqual({
      kind: 'unknown',
      tag: 'GraphqlActivityTimeTravelled',
    });
  });
});
