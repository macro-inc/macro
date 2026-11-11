import { describe, expect, test } from 'bun:test';
import { parseMail } from '../message.ts';
import {
  bodyProblem,
  compose,
  disclosure,
  gate,
  replier,
  replyLimits,
} from '../reply.ts';
import type { Event } from '../store.ts';
import { automated } from '../trust.ts';
import {
  fakeBox,
  fromBase64,
  mail,
  noon,
  type Over,
  pass,
  raw,
  testStore,
  who,
} from './helpers.ts';

const sender = { name: 'Agent', mailbox: who.mailbox };

const allowed = (
  over: Over = {},
  recipients: {
    readonly cc?: readonly string[];
    readonly bcc?: readonly string[];
  } = {},
  past: readonly Event[] = [],
  now = noon
) =>
  gate(
    mail(over),
    { cc: recipients.cc ?? [], bcc: recipients.bcc ?? [] },
    past,
    now,
    who
  );

describe('the gate', () => {
  test('a verified colleague passes', () =>
    expect(allowed()).toEqual({ ok: true, to: 'ada@example.com' }));
  test('everyone outside is no, however it reads', () => {
    for (const from of [
      'x@evil.test',
      'x@example.com.evil.test',
      'x@sub.example.com',
      'CEO <ceo@customer.example>',
    ])
      expect(allowed({ from }).ok).toBe(false);
  });
  test('every recipient must pass', () => {
    expect(allowed({}, { cc: ['bo@example.com'] }).ok).toBe(true);
    for (const bad of [
      'x@evil.test',
      'x@example.com.evil.test',
      'x@sub.example.com',
      'a@example.com, x@evil.test',
      'agent@example.com',
    ]) {
      expect(allowed({}, { cc: [bad] }).ok).toBe(false);
      expect(allowed({}, { bcc: [bad] }).ok).toBe(false);
    }
  });
  test('Reply-To is never followed', () => {
    expect(allowed({ headers: { 'Reply-To': 'x@evil.test' } })).toEqual({
      ok: true,
      to: 'ada@example.com',
    });
    expect(
      compose(
        mail({ headers: { 'Reply-To': 'x@evil.test' } }),
        {
          to: 'ada@example.com',
          cc: [],
          bcc: [],
          body: 'ok',
        },
        sender
      )
    ).not.toContain('evil.test');
  });
  test('loop guards: auto-replies, no-reply, lists', () => {
    const cases: readonly Over[] = [
      { from: 'no-reply@example.com' },
      { from: 'noreply@example.com' },
      { from: 'mailer-daemon@example.com' },
      { from: 'auth@example.com' },
      { headers: { 'Auto-Submitted': 'auto-replied' } },
      { headers: { 'List-Id': 'team <team.example.com>' } },
      { headers: { Precedence: 'bulk' } },
      { headers: { 'X-Autoreply': 'yes' } },
      { headers: { 'Return-Path': '<>' } },
      { subject: 'Automatic reply: back Monday' },
      { subject: 'Out of office' },
      { from: 'agent@example.com' },
      { from: 'agent+review@example.com' },
      { labels: ['SPAM'] },
    ];
    for (const over of cases) expect(allowed(over).ok).toBe(false);
    expect(
      automated(mail({ headers: { 'Auto-Submitted': 'no' } }).headers)
    ).toBeUndefined();
  });
  test('one reply per mail, limits per thread and day', () => {
    const thread = 't-m1';
    expect(
      allowed({}, {}, [{ at: noon, kind: 'reply', thread, message: 'm1' }])
    ).toMatchObject({ ok: false, why: 'already replied to this mail' });
    const two = Array.from({ length: replyLimits.perThreadDay }, (_, i) => ({
      at: noon,
      kind: 'reply' as const,
      thread,
      message: `o${i}`,
    }));
    expect(allowed({}, {}, two)).toMatchObject({
      ok: false,
      why: 'thread limit for today',
    });
    const many = Array.from({ length: replyLimits.perDay }, (_, i) => ({
      at: noon,
      kind: 'reply' as const,
      thread: `other${i}`,
      message: `o${i}`,
    }));
    expect(allowed({}, {}, many)).toMatchObject({
      ok: false,
      why: 'daily limit',
    });
    expect(allowed({}, {}, two, noon.add({ hours: 48 })).ok).toBe(true);
    const ever = Array.from({ length: replyLimits.perThreadEver }, (_, i) => ({
      at: noon,
      kind: 'reply' as const,
      thread,
      message: `o${i}`,
    }));
    expect(allowed({}, {}, ever, noon.add({ hours: 480 }))).toMatchObject({
      ok: false,
      why: 'thread limit',
    });
  });
  test('a reply carries no code or secret out', () => {
    expect(bodyProblem('Your code is 482913')).toBeDefined();
    expect(bodyProblem('see https://x.example/reset?token=abc')).toBeDefined();
    expect(bodyProblem('')).toBeDefined();
    expect(bodyProblem('x'.repeat(replyLimits.maxChars + 1))).toBeDefined();
    expect(bodyProblem('On it. It is fixed.')).toBeUndefined();
  });
  test('compose says it is an agent, signs with its name, and survives header injection', () => {
    const message = raw({ subject: 'hi\r\nBcc: x@evil.test' });
    const out = compose(
      parseMail(message, who),
      {
        to: 'ada@example.com',
        cc: [],
        bcc: [],
        body: 'On it.',
      },
      sender
    );
    const [head = '', body = ''] = out.split('\r\n\r\n');
    expect(head.split('\r\n').filter((line) => /^bcc:/i.test(line))).toEqual(
      []
    );
    expect(fromBase64(body)).toContain(disclosure('Agent'));
    expect(head).toContain('From: Agent <agent@example.com>');
    expect(head).toContain('In-Reply-To: <abc@example.com>');
    expect(head).toContain('Auto-Submitted: auto-replied');
  });
});

describe('the one send path', () => {
  const setup = (messages: Parameters<typeof fakeBox>[0]) => {
    const box = fakeBox(messages);
    const logged: object[] = [];
    const reply = replier({
      box,
      who,
      name: 'Agent',
      parse: (message) => parseMail(message, who),
      store: testStore(),
      locked: (work) => work(),
      log: async (entry) => {
        logged.push(entry);
      },
      now: () => noon,
    });
    const send = (
      id: string,
      text: string,
      more: {
        readonly cc?: string[];
        readonly bcc?: string[];
        readonly dryRun?: boolean;
      } = {}
    ) =>
      reply({
        id,
        text,
        cc: more.cc ?? [],
        bcc: more.bcc ?? [],
        dryRun: more.dryRun === true,
      });
    return { box, logged, send };
  };

  test('a verified colleague gets exactly one reply, saying it is an agent', async () => {
    const { box, send } = setup([raw({ id: 'a' })]);
    expect(await send('a', 'On it.')).toEqual({
      kind: 'replied',
      to: 'ada@example.com',
    });
    expect(box.sent.length).toBe(1);
    const [sent] = box.sent;
    expect(sent?.raw).toContain('To: ada@example.com');
    expect(sent?.threadId).toBe('t-a');
    expect(fromBase64(sent?.raw.split('\r\n\r\n')[1] ?? '')).toContain('agent');
    expect(await send('a', 'Again.')).toMatchObject({ kind: 'refused' });
    expect(box.sent.length).toBe(1);
  });
  test('outsiders, lookalikes, and spoofs get no reply, and the log says why', async () => {
    const { box, logged, send } = setup([
      raw({ id: 'out', from: 'CEO <ceo@customer.example>' }),
      raw({ id: 'look', from: 'x@example.com.evil.test' }),
      raw({ id: 'sub', from: 'x@sub.example.com' }),
      raw({
        id: 'spoof',
        from: 'Owner <owner@example.com>',
        auth: 'mx.google.com; dkim=fail header.i=@example.com; spf=fail; dmarc=fail header.from=example.com',
      }),
      raw({ id: 'noauth', from: 'ada@example.com', auth: null }),
      raw({
        id: 'bot',
        from: 'no-reply@example.com',
        auth: pass('example.com'),
      }),
    ]);
    for (const id of ['out', 'look', 'sub', 'spoof', 'noauth', 'bot', 'gone'])
      expect(await send(id, 'hi')).toMatchObject({ kind: 'refused' });
    expect(box.sent).toEqual([]);
    expect(
      logged.filter((entry) => JSON.stringify(entry).includes('reply-refused'))
        .length
    ).toBe(7);
  });
  test("a Cc or Bcc who isn't a colleague stops the whole reply", async () => {
    const { box, send } = setup([raw({ id: 'a' })]);
    expect(await send('a', 'hi', { cc: ['x@evil.test'] })).toMatchObject({
      kind: 'refused',
    });
    expect(
      await send('a', 'hi', { bcc: ['x@example.com.evil.test'] })
    ).toMatchObject({ kind: 'refused' });
    expect(box.sent).toEqual([]);
    expect(await send('a', 'hi', { cc: ['bo@example.com'] })).toMatchObject({
      kind: 'replied',
    });
    expect(box.sent[0]?.raw).toContain('Cc: bo@example.com');
  });
  test('a dry run sends nothing and counts nothing', async () => {
    const { box, send } = setup([raw({ id: 'a' })]);
    expect(await send('a', 'hi', { dryRun: true })).toEqual({
      kind: 'would-reply',
      to: 'ada@example.com',
    });
    expect(box.sent).toEqual([]);
    expect(await send('a', 'hi')).toMatchObject({ kind: 'replied' });
  });
  test('a text with a code in it is refused, and nothing is counted', async () => {
    const { box, send } = setup([raw({ id: 'a' })]);
    expect(await send('a', 'your code is 482913')).toMatchObject({
      kind: 'refused',
    });
    expect(await send('a', 'On it.')).toMatchObject({ kind: 'replied' });
    expect(box.sent.length).toBe(1);
  });
  test("the reply is counted before it is sent, so a crash can't send twice", async () => {
    const { box, send } = setup([raw({ id: 'a' })]);
    box.send = async () => {
      throw new Error('crashed mid send');
    };
    await expect(send('a', 'On it.')).rejects.toThrow();
    expect(await send('a', 'On it.')).toMatchObject({
      kind: 'refused',
      why: 'already replied to this mail',
    });
  });
});
