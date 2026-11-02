import { afterEach, expect, test } from 'bun:test';
import type { AgentSessionResponse } from '../generated/agent-harness/types.gen';
import { Macro } from '../src/macro';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

const MACRO = new Macro({ token: 'token', webAppUrl: 'https://web.test' });

test('entities with a web page return its url and serialize it', () => {
  const pages = [
    [MACRO.agentSessions.byId('s-1'), 'https://web.test/app/agent/s-1'],
    [MACRO.documents.byId('d-1'), 'https://web.test/app/md/d-1'],
    [MACRO.tasks.byId('t-1'), 'https://web.test/app/task/t-1'],
    [MACRO.channels.byId('c-1'), 'https://web.test/app/channel/c-1'],
    [
      MACRO.channels.byId('c-1').message('m-1'),
      'https://web.test/app/channel/c-1?channel_message_id=m-1',
    ],
    [MACRO.chats.byId('ch-1'), 'https://web.test/app/chat/ch-1'],
    [MACRO.forms.byId('f-1'), 'https://web.test/app/form/f-1'],
    [MACRO.databases.byId('db-1'), 'https://web.test/app/database/db-1'],
    [MACRO.routines.byId('r-1'), 'https://web.test/app/routines/r-1'],
    [MACRO.projects.byId('p-1'), 'https://web.test/app/project/p-1'],
    [MACRO.initiatives.byId('i-1'), 'https://web.test/app/initiative/i-1'],
    [MACRO.calls.byId('call-1'), 'https://web.test/app/call/call-1'],
    [MACRO.email.byId('e-1'), 'https://web.test/app/email/e-1'],
    [MACRO.crm.companyById('co-1'), 'https://web.test/app/company/co-1'],
    [MACRO.crm.contactById('ct-1'), 'https://web.test/app/contact/ct-1'],
    [MACRO.crm.pipelines.byId('pl-1'), 'https://web.test/app/pipeline/pl-1'],
    [MACRO.externalChats.byId('x-1'), 'https://web.test/app/external/chat/x-1'],
  ] as const;

  for (const [entity, url] of pages) {
    expect(entity.webUrl()).toBe(url);
    expect(JSON.parse(JSON.stringify(entity))).toEqual({
      id: entity.id,
      url,
    });
  }
});

test('entities without a web page serialize no url', () => {
  expect(JSON.parse(JSON.stringify(MACRO.users.byId('u-1')))).toEqual({
    id: 'u-1',
  });
});

test('createManaged returns a session whose output carries its url', async () => {
  const session: AgentSessionResponse = {
    botId: 'bot-1',
    canEdit: true,
    createdAt: '2026-08-24T12:00:00Z',
    harness: 'claude-code',
    id: 'session-1',
    model: 'claude-sonnet',
    modifiedAt: '2026-08-24T12:00:00Z',
    name: 'Agent Session',
    isArchived: false,
    ownerId: 'macro|owner@example.com',
    sandboxSize: 'default',
    status: { kind: 'no_messages' },
    workspace: '/workspace',
  };
  globalThis.fetch = (async () =>
    Response.json({ session }, { status: 201 })) as unknown as typeof fetch;
  const client = new Macro({
    token: 'token',
    webAppUrl: 'https://web.test',
    hosts: { 'agent-harness': 'https://agent.test' },
  });

  const created = await client.agentSessions.createManaged({ prompt: 'Hi' });

  expect(created.webUrl()).toBe('https://web.test/app/agent/session-1');
  expect(JSON.parse(JSON.stringify(created))).toEqual({
    id: 'session-1',
    url: 'https://web.test/app/agent/session-1',
    detail: session,
  });
});

test('a meeting serializes its join url once its share token is known', async () => {
  globalThis.fetch = (async () =>
    Response.json({
      id: 'meeting-1',
      shareToken: 'invite-token',
    })) as unknown as typeof fetch;
  const client = new Macro({
    token: 'token',
    webAppUrl: 'https://web.test',
    hosts: { storage: 'https://storage.test' },
  });

  const meeting = await client.meetings.lookup('invite-token');

  expect(JSON.parse(JSON.stringify(meeting))).toMatchObject({
    id: 'meeting-1',
    url: 'https://web.test/app/meet/join/invite-token',
  });
});
