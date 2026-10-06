import { err, ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { expect, it, onTestFinished } from 'vitest';
import type { ShareDeliveryContext } from '../context/share-delivery-context';
import type { PickedRecipient, ShareEvent } from '../core/delivery-plan';
import type {
  ChannelAccessError,
  ChannelAccessLevel,
  ShareItem,
  ShareKind,
} from '../core/share-item';
import { createShareForm } from './create-share-form';

function item(kind: ShareKind, id: string, canGrant = true): ShareItem {
  return {
    kind,
    id,
    name: id,
    markdown: false,
    canGrant,
    channelGrants: new Map(),
  };
}

const channel = (id: string): PickedRecipient => ({ kind: 'channel', id });
const person = (id: string): PickedRecipient => ({ kind: 'user', id });

function setup(items: readonly ShareItem[]) {
  let log: Record<string, string[]> = {};
  const note = (channelId: string, line: string) => {
    log = { ...log, [channelId]: [...(log[channelId] ?? []), line] };
  };
  let events: ShareEvent[] = [];
  const failingPosts = new Set<string>();
  const brokenPosts = new Map<string, Error>();
  const grantErrors = new Map<string, ChannelAccessError>();

  const context: ShareDeliveryContext = {
    async resolvePeopleChannel(userIds) {
      const channelId = `dm:${userIds.join('+')}`;
      note(channelId, 'resolve');
      return channelId;
    },
    async send({ channelId, messageId, items: attached, text }) {
      const broken = brokenPosts.get(messageId);
      if (broken) throw broken;
      if (failingPosts.has(messageId)) {
        note(channelId, `post ${messageId} failed`);
        return undefined;
      }
      const ids = attached.map(({ id }) => id).join(' ');
      note(
        channelId,
        text
          ? `post ${messageId}: ${ids} "${text}"`
          : `post ${messageId}: ${ids}`
      );
      return { open: () => note(channelId, 'open') };
    },
    async changeChannelAccess(ref, change) {
      const level = change.t === 'set' ? change.level : 'removed';
      const error = grantErrors.get(ref.id);
      note(
        change.channelId,
        error ? `grant ${ref.id} ${level} ${error}` : `grant ${ref.id} ${level}`
      );
      return error ? err(error) : ok(undefined);
    },
    track: (event) => {
      events = [...events, event];
    },
  };

  let minted = 0;
  const form = createRoot((dispose) => {
    onTestFinished(dispose);
    return createShareForm<PickedRecipient>(
      {
        items: () => items,
        markdownComments: true,
        mintMessageId: () => `m${++minted}`,
      },
      context
    );
  });

  return {
    form,
    failingPosts,
    brokenPosts,
    grantErrors,
    takeLog: () => {
      const taken = log;
      log = {};
      return taken;
    },
    takeEvents: () => {
      const taken = events;
      events = [];
      return taken;
    },
  };
}

it('grants after the post, except for a kind that needs access first', async () => {
  const { form, takeLog } = setup([
    item('document', 'spec'),
    item('initiative', 'roadmap'),
  ]);
  form.setRecipients([channel('design')]);
  form.setLevel('comment');
  form.setText('Have a look');

  const result = await form.submit();
  result?.open?.();

  expect(takeLog()).toEqual({
    design: [
      'grant roadmap comment',
      'post m1: spec roadmap "Have a look"',
      'grant spec comment',
      'open',
    ],
  });
  expect(form.status().t).toBe('complete');
});

it('retries only the failed delivery, under its planned message id', async () => {
  const spec = item('document', 'spec');
  const { form, takeLog, takeEvents, failingPosts } = setup([spec]);
  form.setRecipients([channel('design'), person('ana')]);
  failingPosts.add('m2');

  const first = await form.submit();

  expect(takeLog()).toEqual({
    design: ['post m1: spec', 'grant spec view'],
    'dm:ana': ['resolve', 'post m2 failed'],
  });
  expect(first).toEqual({
    outcome: {
      complete: false,
      retryable: true,
      anyDelivered: true,
      recipients: [
        {
          key: 'channel:design',
          target: { t: 'channel', channelId: 'design' },
          unsent: [],
          accessIssues: [],
        },
        {
          key: 'people:ana',
          target: { t: 'people', userIds: ['ana'] },
          unsent: [spec],
          accessIssues: [],
        },
      ],
    },
    open: undefined,
  });
  expect(takeEvents()).toEqual([
    { t: 'access-set', item: spec, level: 'view' },
    { t: 'forwarded', item: spec, target: 'channel' },
  ]);

  failingPosts.clear();
  await form.submit();

  expect(takeLog()).toEqual({
    'dm:ana': ['post m2: spec', 'grant spec view'],
  });
  expect(takeEvents()).toEqual([
    { t: 'access-set', item: spec, level: 'view' },
    { t: 'forwarded', item: spec, target: 'user' },
  ]);
  expect(form.status().t).toBe('complete');
});

it('posts later messages and retries to the DM the first post resolved', async () => {
  const docs = Array.from({ length: 11 }, (_, index) =>
    item('document', `doc${index + 1}`, false)
  );
  const { form, takeLog, failingPosts } = setup(docs);
  form.setRecipients([person('ana')]);
  failingPosts.add('m2');

  await form.submit();

  expect(takeLog()).toEqual({
    'dm:ana': [
      'resolve',
      'post m1: doc1 doc2 doc3 doc4 doc5 doc6 doc7 doc8 doc9 doc10',
      'post m2 failed',
    ],
  });

  failingPosts.clear();
  await form.submit();

  expect(takeLog()).toEqual({ 'dm:ana': ['post m2: doc11'] });
});

it.each([
  {
    error: 'failed',
    retry: { 'dm:ana': ['grant roadmap view', 'post m1: roadmap'] },
  },
  { error: 'not-allowed', retry: {} },
] as const)(
  'a $error before-send grant blocks the post',
  async ({ error, retry }) => {
    const roadmap = item('initiative', 'roadmap');
    const { form, takeLog, grantErrors } = setup([roadmap]);
    form.setRecipients([person('ana')]);
    grantErrors.set('roadmap', error);

    const first = await form.submit();

    expect(takeLog()).toEqual({
      'dm:ana': ['resolve', `grant roadmap view ${error}`],
    });
    expect(first?.outcome.recipients).toEqual([
      {
        key: 'people:ana',
        target: { t: 'people', userIds: ['ana'] },
        unsent: [roadmap],
        accessIssues: [{ item: roadmap, error }],
      },
    ]);

    grantErrors.clear();
    await form.submit();

    expect(takeLog()).toEqual(retry);
  }
);

it('retries a failed grant but never a refused one', async () => {
  const spec = item('document', 'spec');
  const brief = item('document', 'brief');
  const { form, takeLog, grantErrors } = setup([spec, brief]);
  form.setRecipients([channel('design')]);
  grantErrors.set('spec', 'not-allowed');
  grantErrors.set('brief', 'failed');

  await form.submit();

  expect(takeLog()).toEqual({
    design: [
      'post m1: spec brief',
      'grant spec view not-allowed',
      'grant brief view failed',
    ],
  });

  grantErrors.clear();
  const retry = await form.submit();

  expect(takeLog()).toEqual({ design: ['grant brief view'] });
  expect(retry?.outcome).toEqual({
    complete: false,
    retryable: false,
    anyDelivered: true,
    recipients: [
      {
        key: 'channel:design',
        target: { t: 'channel', channelId: 'design' },
        unsent: [],
        accessIssues: [{ item: spec, error: 'not-allowed' }],
      },
    ],
  });

  await form.submit();

  expect(takeLog()).toEqual({});
  expect(form.status().t).toBe('incomplete');
});

it('locks recipients, group, level, and text after the first submit', async () => {
  const { form, takeLog, failingPosts } = setup([item('document', 'spec')]);
  form.setRecipients([person('ana'), person('ben')]);
  form.setLevel('comment');
  form.setText('First draft');
  failingPosts.add('m1');
  await form.submit();
  takeLog();

  form.setRecipients([person('cy')]);
  form.setGroup(false);
  form.setLevel('edit');
  form.setText('Second draft');

  expect({
    locked: form.locked(),
    recipients: form.recipients().map(({ id }) => id),
    group: form.group(),
    level: form.level()?.value,
  }).toEqual({
    locked: true,
    recipients: ['ana', 'ben'],
    group: { on: true },
    level: 'comment',
  });

  failingPosts.clear();
  await form.submit();

  expect(takeLog()).toEqual({
    'dm:ana+ben': ['post m1: spec "First draft"', 'grant spec comment'],
  });
});

it('keeps the last outcome on the status while a retry is sending', async () => {
  const { form, failingPosts } = setup([item('document', 'spec')]);
  form.setRecipients([channel('design')]);
  failingPosts.add('m1');
  const first = await form.submit();
  failingPosts.clear();

  const retry = form.submit();

  expect(form.status()).toEqual({
    t: 'sending',
    plan: expect.anything(),
    previousOutcome: first?.outcome,
  });
  await retry;
  expect(form.status().t).toBe('complete');
});

it('settles the form and keeps the other recipients when a send throws', async () => {
  const spec = item('document', 'spec');
  const { form, takeLog, brokenPosts } = setup([spec]);
  form.setRecipients([channel('design'), channel('review')]);
  const broken = new Error('send threw');
  brokenPosts.set('m2', broken);

  await expect(form.submit()).rejects.toBe(broken);

  expect(form.status()).toMatchObject({
    t: 'incomplete',
    outcome: { anyDelivered: true, retryable: true },
  });
  expect(takeLog()).toEqual({ design: ['post m1: spec', 'grant spec view'] });

  brokenPosts.clear();
  await form.submit();

  expect(takeLog()).toEqual({ review: ['post m2: spec', 'grant spec view'] });
  expect(form.status().t).toBe('complete');
});

it('flags a submit with no valid recipient and sends nothing', async () => {
  const { form, takeLog } = setup([item('document', 'spec')]);
  form.setRecipients([
    { kind: 'custom', id: 'not-an-email', data: { invalid: true } },
  ]);

  const rejected = await form.submit();

  expect({
    rejected,
    triedToSubmit: form.triedToSubmit(),
    status: form.status(),
    log: takeLog(),
  }).toEqual({
    rejected: undefined,
    triedToSubmit: true,
    status: { t: 'editing' },
    log: {},
  });

  form.setRecipients([channel('design')]);
  await form.submit();

  expect(takeLog()).toEqual({ design: ['post m1: spec', 'grant spec view'] });
});

it("starts at the channel's existing grant until the user picks a level", () => {
  const spec: ShareItem = {
    ...item('document', 'spec'),
    channelGrants: new Map<string, ChannelAccessLevel>([['design', 'edit']]),
  };
  const { form } = setup([spec]);
  form.setRecipients([channel('design')]);
  const prefilled = form.level()?.value;

  form.setLevel('view');

  expect([prefilled, form.level()?.value]).toEqual(['edit', 'view']);
});
