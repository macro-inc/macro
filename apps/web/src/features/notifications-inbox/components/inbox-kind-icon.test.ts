import type { EntityData } from '@entity';
import { describe, expect, it } from 'vitest';
import { inboxEntityColor } from './inbox-kind-icon';

const entity = (fields: Record<string, unknown>) =>
  ({ id: 'entity', name: 'Entity', ...fields }) as unknown as EntityData;

describe('inboxEntityColor', () => {
  it('colors by what the notification is on', () => {
    const email = inboxEntityColor(entity({ type: 'email', isRead: false }));
    const agent = inboxEntityColor(entity({ type: 'agent_session' }));
    expect(email).not.toBe(agent);
  });

  it('keeps an email’s color once it is read', () => {
    expect(inboxEntityColor(entity({ type: 'email', isRead: true }))).toBe(
      inboxEntityColor(entity({ type: 'email', isRead: false }))
    );
  });

  it('gives every kind of channel the same color', () => {
    const channel = inboxEntityColor(
      entity({ type: 'channel', channelType: 'public' })
    );
    expect(
      inboxEntityColor(entity({ type: 'channel', channelType: 'private' }))
    ).toBe(channel);
    expect(
      inboxEntityColor(
        entity({ type: 'channel', channelType: 'direct_message' })
      )
    ).toBe(channel);
  });
});
