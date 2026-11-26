import { describe, expect, it } from 'vitest';
import {
  listedNotificationEvents,
  NOTIFICATION_EVENT_GROUPS,
} from '../notification-event-catalog';

const labels = (agentNotifications: boolean, macroComputers = true) =>
  NOTIFICATION_EVENT_GROUPS.flatMap((group) =>
    listedNotificationEvents(group, { agentNotifications, macroComputers }).map(
      (event) => event.label
    )
  );

describe('the notification settings a person is offered', () => {
  it('lists Agent pings while agent notifications are on for them', () => {
    expect(labels(true)).toContain('Agent pings');
  });

  it('leaves out only Agent pings while they are off', () => {
    expect(labels(false)).toEqual(
      labels(true).filter((label) => label !== 'Agent pings')
    );
    expect(labels(false)).toContain('Routine runs');
  });

  it('leaves out Macro computer events while those are off', () => {
    expect(labels(true, true)).toContain('Computer agent sign-ins');
    expect(labels(true, false)).not.toContain('Computer agent sign-ins');
    expect(labels(true, false)).toContain('Agent pings');
  });
});
