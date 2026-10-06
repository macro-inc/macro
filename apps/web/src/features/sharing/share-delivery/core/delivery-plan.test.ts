import { err, ok, type Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import {
  type DeliveryLedger,
  emptyLedger,
  emptyRecord,
  planShare,
  prefillChannel,
  remainingWork,
  type ShareRequest,
  type ShareTarget,
  shareEvents,
  shareNotices,
  summarizeShare,
  type TargetRecord,
  targetKey,
  targetsFor,
  withDelivery,
  withGrant,
} from './delivery-plan';
import type {
  ChannelAccessError,
  ChannelAccessLevel,
  ShareItem,
} from './share-item';

const item = (id: string, overrides: Partial<ShareItem> = {}): ShareItem => ({
  kind: 'document',
  id,
  name: id,
  markdown: false,
  canGrant: true,
  channelGrants: new Map(),
  ...overrides,
});

const docs = (count: number) =>
  Array.from({ length: count }, (_, index) => item(`doc-${index + 1}`));

const channel = (channelId: string): ShareTarget => ({
  t: 'channel',
  channelId,
});

const request = (overrides: Partial<ShareRequest> = {}): ShareRequest => ({
  items: docs(2),
  targets: [channel('channel-1')],
  text: 'Have a look',
  level: 'view',
  ...overrides,
});

const plan = (overrides: Partial<ShareRequest> = {}) => {
  let minted = 0;
  return planShare(request(overrides), () => `message-${++minted}`);
};

const update = (
  ledger: DeliveryLedger,
  target: ShareTarget,
  channelId: string,
  change: (record: TargetRecord) => TargetRecord
): DeliveryLedger => {
  const key = targetKey(target);
  return new Map(ledger).set(
    key,
    change(ledger.get(key) ?? emptyRecord(channelId))
  );
};

const deliver = (
  ledger: DeliveryLedger,
  target: ShareTarget,
  messageId: string,
  channelId = 'channel-1'
) =>
  update(ledger, target, channelId, (record) =>
    withDelivery(record, messageId)
  );

const grant = (
  ledger: DeliveryLedger,
  target: ShareTarget,
  granted: ShareItem,
  result: Result<void, ChannelAccessError>,
  {
    level = 'view',
    channelId = 'channel-1',
  }: {
    level?: ChannelAccessLevel;
    channelId?: string;
  } = {}
) =>
  update(ledger, target, channelId, (record) =>
    withGrant(record, { item: granted, level, result })
  );

describe('planShare', () => {
  it('splits a large batch into messages of at most ten, with the text on the first', () => {
    const { targets } = plan({
      items: docs(23),
      targets: [channel('channel-1'), channel('channel-2')],
    });
    expect(
      targets.map(({ messages }) =>
        messages.map(({ id, items, text }) => [id, items.length, text])
      )
    ).toEqual([
      [
        ['message-1', 10, 'Have a look'],
        ['message-2', 10, ''],
        ['message-3', 3, ''],
      ],
      [
        ['message-4', 10, 'Have a look'],
        ['message-5', 10, ''],
        ['message-6', 3, ''],
      ],
    ]);
  });

  it('never attaches an owner-only item the sender does not own', () => {
    const session = item('session-1', {
      kind: 'agent_session',
      canGrant: false,
    });
    const [target] = plan({ items: [item('doc-1'), session] }).targets;
    expect(target.messages.map(({ items }) => items)).toEqual([
      [item('doc-1')],
    ]);
  });

  it('grants native projects before the post and everything else after, capped per kind', () => {
    const project = item('initiative-1', { kind: 'initiative' });
    const thread = item('thread-1', { kind: 'email' });
    const call = item('call-1', { kind: 'call' });
    const [target] = plan({
      items: [project, item('doc-1'), thread, call],
      level: 'edit',
    }).targets;
    expect(target.messages).toEqual([
      {
        id: 'message-1',
        items: [project, item('doc-1'), thread, call],
        text: 'Have a look',
        grantFirst: [{ item: project, level: 'edit' }],
        grantAfter: [
          { item: item('doc-1'), level: 'edit' },
          { item: thread, level: 'view' },
        ],
      },
    ]);
  });
});

describe('remainingWork', () => {
  it('leaves only the undelivered messages after a partial send', () => {
    const share = plan({
      items: docs(23).map((doc) => ({ ...doc, canGrant: false })),
    });
    const ledger = deliver(emptyLedger, channel('channel-1'), 'message-1');
    const [work] = remainingWork(share, ledger);
    expect(work.unsentMessages.map(({ id, text }) => [id, text])).toEqual([
      ['message-2', ''],
      ['message-3', ''],
    ]);
    expect(work.pendingGrants).toEqual([]);
  });

  it('retries a failed grant without sending again, and never a refused one', () => {
    const target = channel('channel-1');
    const share = plan();
    let ledger = deliver(emptyLedger, target, 'message-1');
    ledger = grant(ledger, target, item('doc-1'), err('not-allowed'));
    ledger = grant(ledger, target, item('doc-2'), err('failed'));
    expect(remainingWork(share, ledger)).toEqual([
      {
        key: targetKey(target),
        channel: { t: 'known', record: ledger.get(targetKey(target)) },
        pendingGrants: [{ item: item('doc-2'), level: 'view' }],
        unsentMessages: [],
      },
    ]);
  });

  it('looks people up only until their channel is known', () => {
    const people: ShareTarget = { t: 'people', userIds: ['user-1'] };
    const share = plan({ targets: [channel('channel-1'), people] });
    const resolved = update(emptyLedger, people, 'dm-1', (record) => record);
    expect(
      remainingWork(share, emptyLedger).map((work) => work.channel)
    ).toEqual([
      { t: 'known', record: emptyRecord('channel-1') },
      { t: 'unknown', userIds: ['user-1'] },
    ]);
    expect(remainingWork(share, resolved).map((work) => work.channel)).toEqual([
      { t: 'known', record: emptyRecord('channel-1') },
      { t: 'known', record: emptyRecord('dm-1') },
    ]);
  });

  it('posts without repeating a before-send grant that already landed', () => {
    const project = item('initiative-1', { kind: 'initiative' });
    const people: ShareTarget = { t: 'people', userIds: ['user-1'] };
    const share = plan({ items: [project], targets: [people] });
    const ledger = grant(emptyLedger, people, project, ok(undefined), {
      channelId: 'dm-1',
    });
    expect(remainingWork(share, ledger)).toEqual([
      {
        key: targetKey(people),
        channel: { t: 'known', record: ledger.get(targetKey(people)) },
        pendingGrants: [],
        unsentMessages: [
          {
            id: 'message-1',
            items: [project],
            text: 'Have a look',
            grantFirst: [],
            grantAfter: [],
          },
        ],
      },
    ]);
    expect(ledger.get(targetKey(people))?.channelId).toBe('dm-1');
  });

  it('stops a target at a message whose before-send grant was refused', () => {
    const project = item('initiative-1', { kind: 'initiative' });
    const target = channel('channel-1');
    const share = plan({ items: [project] });
    const refused = grant(emptyLedger, target, project, err('not-allowed'));
    const failed = grant(emptyLedger, target, project, err('failed'));
    expect(remainingWork(share, refused)).toEqual([]);
    expect(
      remainingWork(share, failed).map(({ unsentMessages }) =>
        unsentMessages.map(({ grantFirst }) => grantFirst)
      )
    ).toEqual([[[{ item: project, level: 'view' }]]]);
  });

  it('keeps grants apart for two kinds that share an id', () => {
    const target = channel('channel-1');
    const document = item('shared-id');
    const chat = item('shared-id', { kind: 'chat' });
    const share = plan({ items: [document, chat] });
    let ledger = deliver(emptyLedger, target, 'message-1');
    ledger = grant(ledger, target, document, ok(undefined));
    expect(remainingWork(share, ledger)).toEqual([
      {
        key: targetKey(target),
        channel: { t: 'known', record: ledger.get(targetKey(target)) },
        pendingGrants: [{ item: chat, level: 'view' }],
        unsentMessages: [],
      },
    ]);
  });

  it('records a delivery and lets a later grant clear an error', () => {
    const record = withGrant(
      withGrant(emptyRecord('dm-1'), {
        item: item('doc-1'),
        level: 'view',
        result: err('failed'),
      }),
      { item: item('doc-1'), level: 'view', result: ok(undefined) }
    );
    expect(withDelivery(record, 'message-1')).toEqual({
      channelId: 'dm-1',
      delivered: new Set(['message-1']),
      granted: new Map([['document:doc-1', 'view']]),
      grantErrors: new Map(),
    });
  });
});

describe('targets', () => {
  it('names a group the same way whatever the recipient order', () => {
    expect(targetKey({ t: 'people', userIds: ['b', 'a'] })).toBe(
      targetKey({ t: 'people', userIds: ['a', 'b'] })
    );
    expect(targetKey({ t: 'people', userIds: ['a', 'b'] })).not.toBe(
      targetKey({ t: 'people', userIds: ['a'] })
    );
  });

  it('skips invalid custom email chips in both modes', () => {
    const recipients = [
      { kind: 'user', id: 'user-1' },
      { kind: 'custom', id: 'typo', data: { invalid: true } },
    ] as const;
    expect(targetsFor(recipients, false)).toEqual([
      { t: 'people', userIds: ['user-1'] },
    ]);
    expect(targetsFor(recipients, true)).toEqual([
      { t: 'people', userIds: ['user-1'] },
    ]);
  });

  it('groups people only when no channel is among the recipients', () => {
    const people = [
      { kind: 'user', id: 'user-1' },
      { kind: 'contact', id: 'user-2' },
    ] as const;
    expect(targetsFor(people, true)).toEqual([
      { t: 'people', userIds: ['user-1', 'user-2'] },
    ]);
    expect(
      targetsFor([...people, { kind: 'channel', id: 'channel-1' }], true)
    ).toEqual([
      { t: 'people', userIds: ['user-1'] },
      { t: 'people', userIds: ['user-2'] },
      { t: 'channel', channelId: 'channel-1' },
    ]);
  });

  it('collapses duplicate recipients', () => {
    expect(
      targetsFor(
        [
          { kind: 'channel', id: 'channel-1' },
          { kind: 'channel', id: 'channel-1' },
        ],
        false
      )
    ).toEqual([{ t: 'channel', channelId: 'channel-1' }]);
  });

  it('prefills from the sole recipient only when it is a channel', () => {
    expect(prefillChannel([{ kind: 'channel', id: 'channel-1' }])).toBe(
      'channel-1'
    );
    expect(
      prefillChannel([
        { kind: 'channel', id: 'channel-1' },
        { kind: 'user', id: 'user-1' },
      ])
    ).toBeUndefined();
  });
});

describe('summarizeShare', () => {
  it('is complete once every target has every message and owed grant', () => {
    const target = channel('channel-1');
    const share = plan();
    let ledger = deliver(emptyLedger, target, 'message-1');
    ledger = grant(ledger, target, item('doc-1'), ok(undefined));
    expect(summarizeShare(share, ledger)).toMatchObject({
      complete: false,
      retryable: true,
    });
    ledger = grant(ledger, target, item('doc-2'), ok(undefined));
    expect(summarizeShare(share, ledger)).toMatchObject({
      complete: true,
      retryable: false,
      anyDelivered: true,
    });
  });

  it('reports a refused grant per recipient and item, and offers no retry', () => {
    const target = channel('channel-1');
    const share = plan({ items: docs(1) });
    let ledger = deliver(emptyLedger, target, 'message-1');
    ledger = grant(ledger, target, item('doc-1'), err('not-allowed'));
    expect(summarizeShare(share, ledger)).toEqual({
      complete: false,
      retryable: false,
      anyDelivered: true,
      recipients: [
        {
          key: targetKey(target),
          target,
          unsent: [],
          accessIssues: [{ item: item('doc-1'), error: 'not-allowed' }],
        },
      ],
    });
  });

  it('reports a project whose before-send grant failed as unsent with an access issue', () => {
    const project = item('initiative-1', { kind: 'initiative' });
    const target = channel('channel-1');
    const share = plan({ items: [project] });
    const ledger = grant(emptyLedger, target, project, err('failed'));
    expect(summarizeShare(share, ledger)).toEqual({
      complete: false,
      retryable: true,
      anyDelivered: false,
      recipients: [
        {
          key: targetKey(target),
          target,
          unsent: [project],
          accessIssues: [{ item: project, error: 'failed' }],
        },
      ],
    });
  });

  it('offers a retry while any recipient is missing a message', () => {
    expect(summarizeShare(plan(), emptyLedger)).toMatchObject({
      complete: false,
      retryable: true,
      anyDelivered: false,
      recipients: [{ unsent: docs(2), accessIssues: [] }],
    });
  });
});

describe('shareNotices', () => {
  it('says what happens to each item before anything is sent', () => {
    const session = item('session-1', {
      kind: 'agent_session',
      canGrant: false,
    });
    const notOwned = item('doc-2', { canGrant: false });
    const thread = item('thread-1', { kind: 'email' });
    expect(
      shareNotices([item('doc-1'), notOwned, thread, session], 'edit')
    ).toEqual([
      { t: 'left-out', items: [session] },
      { t: 'not-owner', items: [notOwned] },
      { t: 'capped', items: [thread], level: 'view' },
    ]);
    expect(shareNotices([item('doc-1'), thread], 'view')).toEqual([]);
  });

  it('warns when each recipient will get more than one message', () => {
    expect(shareNotices(docs(11), 'view')).toEqual([
      { t: 'split', messagesPerRecipient: 2 },
    ]);
    expect(shareNotices(docs(10), 'view')).toEqual([]);
  });
});

describe('shareEvents', () => {
  it('counts a forward once its grant lands, and each confirmed grant once', () => {
    const target = channel('channel-1');
    const share = plan({ items: docs(1) });
    const delivered = deliver(emptyLedger, target, 'message-1');
    const granted = grant(delivered, target, item('doc-1'), ok(undefined));
    const ref = { kind: 'document', id: 'doc-1' };

    expect(shareEvents(share, emptyLedger, delivered)).toEqual([]);
    expect(shareEvents(share, delivered, granted)).toEqual([
      { t: 'access-set', item: expect.objectContaining(ref), level: 'view' },
      { t: 'forwarded', item: expect.objectContaining(ref), target: 'channel' },
    ]);
    expect(shareEvents(share, granted, granted)).toEqual([]);
  });

  it('counts a forward on delivery when nothing is owed, as a user share for people', () => {
    const people: ShareTarget = { t: 'people', userIds: ['user-1'] };
    const share = plan({
      items: [item('doc-1', { canGrant: false })],
      targets: [people],
    });
    const delivered = deliver(emptyLedger, people, 'message-1', 'dm-1');
    expect(shareEvents(share, emptyLedger, delivered)).toEqual([
      {
        t: 'forwarded',
        item: expect.objectContaining({ kind: 'document', id: 'doc-1' }),
        target: 'user',
      },
    ]);
  });
});
