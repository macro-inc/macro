import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';
import { MacroApiError, MacroForbiddenError } from '../src/utils';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Answer every request with `response`, recording each one. */
function serve(response: () => Response): Request[] {
  const requests: Request[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      return response();
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

function macro(): Macro {
  return new Macro({
    auth: { type: 'user', apiKey: 'mak_test' },
    hosts: { notification: 'https://notification.test' },
  });
}

/** Answer with who the server notified and who it skipped. */
function outcome(notified: string[], skipped: string[] = []): () => Response {
  return () =>
    Response.json({
      notified,
      skipped: skipped.map((userId) => ({ userId, reason: 'no_access' })),
    });
}

test('sends a task link to teammates as a document and reports who was skipped', async () => {
  const requests = serve(
    outcome(['macro|teammate@example.com'], ['macro|outsider@example.com']),
  );
  const sdk = macro();
  const teammate = sdk.users.byId('macro|teammate@example.com');
  const outsider = sdk.users.byId('macro|outsider@example.com');

  const result = await sdk.notifications.send({
    title: 'Deploy finished',
    body: 'All 3 services are live.',
    link: sdk.tasks.byId('task-1'),
    to: [teammate, outsider],
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe('POST');
  expect(new URL(requests[0].url).pathname).toBe('/v1/user_notifications/send');
  expect(await requests[0].json()).toEqual({
    title: 'Deploy finished',
    body: 'All 3 services are live.',
    link: { entityType: 'document', entityId: 'task-1' },
    recipientIds: ['macro|teammate@example.com', 'macro|outsider@example.com'],
  });
  // The caller's own handles come back, not new ones.
  expect(result.notified).toEqual([teammate]);
  expect(result.notified[0]).toBe(teammate);
  expect(result.skipped).toHaveLength(1);
  expect(result.skipped[0].user).toBe(outsider);
  expect(result.skipped[0].reason).toBe('no_access');
});

test('one recipient need not be a list', async () => {
  const requests = serve(outcome(['macro|teammate@example.com']));
  const sdk = macro();

  const result = await sdk.notifications.send({
    title: 'Look at this',
    link: sdk.documents.byId('doc-1'),
    to: sdk.users.byId('macro|teammate@example.com'),
  });

  expect(await requests[0].json()).toEqual({
    title: 'Look at this',
    link: { entityType: 'document', entityId: 'doc-1' },
    recipientIds: ['macro|teammate@example.com'],
  });
  expect(result.notified.map((user) => user.id)).toEqual([
    'macro|teammate@example.com',
  ]);
  expect(result.skipped).toEqual([]);
});

test('a ping to yourself names no recipient and returns you', async () => {
  const requests = serve(outcome(['macro|me@example.com']));
  const sdk = macro();

  const result = await sdk.notifications.send({
    title: '3 new leads',
    link: sdk.agentSessions.byId('session-1'),
  });

  expect(await requests[0].json()).toEqual({
    title: '3 new leads',
    link: { entityType: 'agent_session', entityId: 'session-1' },
  });
  expect(result.notified.map((user) => user.id)).toEqual([
    'macro|me@example.com',
  ]);
});

test('an empty recipient list sends nothing', async () => {
  const requests = serve(outcome([]));
  const sdk = macro();

  const result = await sdk.notifications.send({
    title: 'Nobody matched',
    link: sdk.agentSessions.byId('session-1'),
    to: [],
  });

  expect(requests).toHaveLength(0);
  expect(result).toEqual({ notified: [], skipped: [] });
});

test('a link the sender cannot see is refused', async () => {
  serve(() =>
    Response.json(
      { message: 'the linked entity was not found' },
      { status: 404 },
    ),
  );
  const sdk = macro();

  const sending = sdk.notifications.send({
    title: 'Look at this',
    link: sdk.documents.byId('doc-1'),
    to: sdk.users.byId('macro|teammate@example.com'),
  });

  await expect(sending).rejects.toBeInstanceOf(MacroApiError);
});

test('a link to an entity notifications cannot open is rejected before sending', async () => {
  const requests = serve(outcome([]));
  const sdk = macro();

  const sending = sdk.notifications.send({
    title: 'Look at this',
    link: sdk.users.byId('macro|teammate@example.com') as never,
  });

  await expect(sending).rejects.toBeInstanceOf(TypeError);
  expect(requests).toHaveLength(0);
});

test('each kind of link names its entity type', async () => {
  const requests = serve(outcome(['macro|me@example.com']));
  const sdk = macro();
  const links = [
    [sdk.channels.byId('channel-1'), 'channel', 'channel-1'],
    // A message is named by itself; the server finds its channel.
    [
      sdk.channels.byId('channel-1').message('message-1'),
      'channel_message',
      'message-1',
    ],
    [sdk.projects.byId('folder-1'), 'project', 'folder-1'],
    [sdk.initiatives.byId('project-1'), 'initiative', 'project-1'],
    [sdk.email.byId('thread-1'), 'email_thread', 'thread-1'],
    [sdk.calendar.event('event-1'), 'calendar_event', 'event-1'],
    [sdk.crm.companyById('company-1'), 'crm_company', 'company-1'],
    [sdk.crm.contactById('contact-1'), 'crm_contact', 'contact-1'],
    [sdk.agentSessions.byId('session-1'), 'agent_session', 'session-1'],
  ] as const;

  for (const [link] of links) {
    await sdk.notifications.send({ title: 'New activity', link });
  }

  expect(await Promise.all(requests.map((request) => request.json()))).toEqual(
    links.map(([, entityType, entityId]) => ({
      title: 'New activity',
      link: { entityType, entityId },
    })),
  );
});

test('a sender over the hourly ceiling is told why and when to retry', async () => {
  const message =
    'too many notifications: a sender can notify at most 1000 recipients an hour; try again in 12 minutes';
  serve(() => Response.json({ message }, { status: 429 }));
  const sdk = macro();

  const sending = sdk.notifications.send({
    title: 'Look at this',
    link: sdk.documents.byId('doc-1'),
  });

  await expect(sending).rejects.toThrow(`Macro API error 429: ${message}`);
});

test('a sender without the feature is told it is not enabled', async () => {
  const message = 'agent notifications are not enabled for this account';
  serve(() => Response.json({ message }, { status: 403 }));
  const sdk = macro();

  const sending = sdk.notifications.send({
    title: 'Look at this',
    link: sdk.documents.byId('doc-1'),
  });

  await expect(sending).rejects.toBeInstanceOf(MacroForbiddenError);
  await expect(sending).rejects.toThrow(`Macro API error 403: ${message}`);
});

test('links the inbox never lists are rejected before sending', async () => {
  const requests = serve(() => new Response(null, { status: 204 }));
  const sdk = macro();

  for (const link of [
    sdk.routines.byId('routine-1'),
    sdk.databases.byId('database-1'),
    sdk.forms.byId('form-1'),
  ]) {
    const sending = sdk.notifications.send({
      title: 'New response',
      link: link as never,
    });
    await expect(sending).rejects.toBeInstanceOf(TypeError);
  }
  expect(requests).toHaveLength(0);
});
