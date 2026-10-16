import { describe, expect, it } from 'vitest';
import { deliveryPresentation, messagingError } from './delivery';
import { deliveryTimelineKeys, visibleDeliveryIds } from './timeline';

describe('external delivery presentation', () => {
  it('does not call provider acceptance delivered or read', () => {
    expect(deliveryPresentation('accepted', 'instagram').label).toBe(
      'Sent to Instagram'
    );
    expect(deliveryPresentation('accepted', 'instagram').detail).toContain(
      'not confirmed'
    );
    expect(deliveryPresentation('delivered', 'instagram').label).toBe(
      'Delivered'
    );
    expect(deliveryPresentation('read', 'instagram').label).toBe('Read');
  });
  it('labels only a definitive expiry Not sent, preserving uncertainty and acceptance', () => {
    expect(
      deliveryPresentation('failed', 'whatsapp', 'send_expired').label
    ).toBe('Not sent');
    expect(
      deliveryPresentation('failed', 'whatsapp', 'send_expired').detail
    ).toContain('10 minutes');
    expect(
      deliveryPresentation('unknown', 'whatsapp', 'send_expired').label
    ).toBe('Delivery not confirmed');
    expect(
      deliveryPresentation('accepted', 'instagram', 'send_expired').label
    ).toBe('Sent to Instagram');
  });
  it('explains uncertainty without claiming failure or inviting a blind retry', () => {
    const status = deliveryPresentation(
      'unknown',
      'whatsapp',
      'interrupted_send_check_provider'
    );
    expect(status.label).toBe('Delivery not confirmed');
    expect(status.detail).toContain('may have arrived');
    expect(status.detail).toContain('Check WhatsApp');
  });
  it('turns server/provider details into actions and keeps unknown errors private', () => {
    expect(
      messagingError('Meta credential encryption is not configured', 'whatsapp')
    ).toContain('administrator');
    expect(messagingError('provider_error_190', 'instagram')).toContain(
      'reconnect'
    );
    expect(
      messagingError(
        'this number is not registered for WhatsApp Business app coexistence',
        'whatsapp'
      )
    ).toContain('WhatsApp Manager');
    expect(messagingError('131047', 'whatsapp')).toContain('approved template');
    expect(messagingError('provider_error_131030', 'whatsapp')).toContain(
      'test recipient'
    );
    expect(
      messagingError('unexpected token=secret internal host', 'instagram')
    ).not.toContain('secret');
  });
});

describe('native message and send-attempt timeline', () => {
  it('looks up visible older replies without re-fetching known statuses or internal notes', () => {
    const keys = Array.from({ length: 250 }, (_, index) => `message-${index}`);
    const eligible = new Set(keys.filter((_, index) => index % 2 === 0));
    const ids = visibleDeliveryIds(keys, eligible, new Set(['message-20']), {
      first: 'message-20',
      last: 'message-30',
    });
    expect(ids).not.toContain('message-20');
    expect(ids).not.toContain('message-21');
    expect(ids).toContain('message-22');
    expect(ids).not.toContain('message-200');
    expect(ids.length).toBeLessThanOrEqual(100);
  });
  const messages = [
    {
      key: 'first',
      position: { id: 'first', createdAt: '2026-10-11T10:00:00Z' },
    },
    {
      key: 'last',
      position: { id: 'last', createdAt: '2026-10-11T12:00:00Z' },
    },
  ];
  const send = {
    id: 'attempt',
    channel_id: 'a',
    created_at: '2026-10-11T11:00:00Z',
  };
  it('places a failed/pending reply beside its own chronological context', () => {
    expect(deliveryTimelineKeys('a', messages, [send], true)).toEqual([
      'first',
      'external-send:attempt',
      'last',
    ]);
  });
  it('removes the attempt when its native message is materialized and isolates channels', () => {
    expect(
      deliveryTimelineKeys(
        'a',
        messages,
        [
          { ...send, message_id: 'last' },
          { ...send, id: 'other', channel_id: 'b' },
        ],
        true
      )
    ).toEqual(['first', 'last']);
  });
  it('preserves activity rows while replacing an accepted attempt with its native message', () => {
    const activity = {
      key: 'activity:joined',
      position: { id: 'joined', createdAt: '2026-10-11T10:30:00Z' },
    };
    const entries = [messages[0], activity, messages[1]];
    const accepted = { ...send, message_id: 'native-reply' };
    expect(deliveryTimelineKeys('a', entries, [accepted], true)).toEqual([
      'first',
      'activity:joined',
      'external-send:attempt',
      'last',
    ]);
    expect(
      deliveryTimelineKeys(
        'a',
        [
          messages[0],
          activity,
          {
            key: 'native-reply',
            position: { id: 'native-reply', createdAt: send.created_at },
          },
          messages[1],
        ],
        [accepted],
        true
      )
    ).toEqual(['first', 'activity:joined', 'native-reply', 'last']);
  });
  it('keeps an accepted reply visible while the native event is delayed', () => {
    const accepted = { ...send, message_id: 'native-reply' };
    expect(deliveryTimelineKeys('a', messages, [accepted], true)).toEqual([
      'first',
      'external-send:attempt',
      'last',
    ]);
    const loaded = [
      ...messages,
      {
        key: 'native-reply',
        position: { id: 'native-reply', createdAt: send.created_at },
      },
    ];
    const keys = deliveryTimelineKeys('a', loaded, [accepted], true);
    expect(keys).toContain('native-reply');
    expect(keys).not.toContain('external-send:attempt');
  });
  it('does not append recent attempts to an older history window', () => {
    const later = { ...send, created_at: '2026-10-11T13:00:00Z' };
    expect(deliveryTimelineKeys('a', messages, [later], false)).toEqual([
      'first',
      'last',
    ]);
    expect(deliveryTimelineKeys('a', messages, [later], true)).toEqual([
      'first',
      'last',
      'external-send:attempt',
    ]);
  });
});

it('distinguishes Meta app access from Macro channel permissions', () => {
  expect(messagingError('200', 'instagram')).toContain('in Meta');
  expect(
    messagingError(
      'Meta has not granted this app messaging access',
      'instagram'
    )
  ).toContain('in Meta');
  expect(messagingError('forbidden', 'instagram')).toContain(
    'channel and account access'
  );
});

it('keeps native activity ordering and microseconds when inserting pending sends', () => {
  const entries = [
    {
      key: 'activity:0b',
      position: { id: '0b', createdAt: '2026-10-14T10:00:00.000001Z' },
    },
    {
      key: '0a',
      position: { id: '0a', createdAt: '2026-10-14T10:00:00.000003Z' },
    },
  ];
  expect(
    deliveryTimelineKeys(
      'a',
      entries,
      [
        {
          id: 'attempt',
          channel_id: 'a',
          created_at: '2026-10-14T10:00:00.000002Z',
        },
      ],
      true
    )
  ).toEqual(['activity:0b', 'external-send:attempt', '0a']);
});
