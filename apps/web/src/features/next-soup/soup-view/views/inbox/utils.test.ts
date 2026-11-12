import type { EntityData, Notification } from '@entity';
import { expect, it } from 'vitest';
import { itemContent } from './utils';

it.each(['view', 'comment', 'edit'] as const)(
  'shows readable %s request and grant previews without a text field',
  (accessLevel) => {
    const entity: EntityData = {
      type: 'document',
      id: 'document',
      name: 'Private document',
      ownerId: 'owner',
    };
    const base = {
      id: 'notification',
      entity_id: entity.id,
      entity_type: 'document' as const,
      created_at: '2026-10-15T00:00:00Z',
      updated_at: '2026-10-15T00:00:00Z',
      sent: true,
      state: 'unseen' as const,
    };
    const content = {
      requestId: 'request',
      revision: 1,
      entityName: entity.name,
      accessLevel,
    };
    const requested: Notification = {
      ...base,
      notification_event_type: 'entity_access_requested',
      notification_metadata: { tag: 'entity_access_requested', content },
    };
    const granted: Notification = {
      ...base,
      notification_event_type: 'entity_access_granted',
      notification_metadata: { tag: 'entity_access_granted', content },
    };
    expect(itemContent(entity, requested)).toBe(
      `Requested ${accessLevel} access`
    );
    expect(itemContent(entity, granted)).toBe(
      `Granted you ${accessLevel} access`
    );
  }
);

it('shows what a ping says, not the linked channel message', () => {
  const entity = {
    type: 'channel',
    id: 'channel',
    name: 'Deploys',
    ownerId: 'owner',
    latestRootMessage: { content: 'Someone else wrote this' },
  } as EntityData;
  const notification: Notification = {
    id: 'notification',
    entity_id: entity.id,
    entity_type: 'channel',
    created_at: '2026-11-09T00:00:00Z',
    updated_at: '2026-11-09T00:00:00Z',
    sent: true,
    state: 'unseen',
    notification_event_type: 'ping',
    notification_metadata: {
      tag: 'ping',
      content: { title: 'Deploy finished', body: 'All 3 services are live.' },
    },
  };
  expect(itemContent(entity, notification)).toBe(
    'Deploy finished — All 3 services are live.'
  );
});
