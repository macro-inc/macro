import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';
import { MacroApiError } from '../src/utils';

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

test('sends a task link to a teammate as a document', async () => {
  const requests = serve(() => new Response(null, { status: 204 }));
  const sdk = macro();

  await sdk.notifications.send({
    title: 'Deploy finished',
    body: 'All 3 services are live.',
    link: sdk.tasks.byId('task-1'),
    to: sdk.users.byId('macro|teammate@example.com'),
  });

  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe('POST');
  expect(new URL(requests[0].url).pathname).toBe('/v1/user_notifications/send');
  expect(await requests[0].json()).toEqual({
    title: 'Deploy finished',
    body: 'All 3 services are live.',
    link: { entityType: 'document', entityId: 'task-1' },
    recipientId: 'macro|teammate@example.com',
  });
});

test('a note to yourself names no recipient', async () => {
  const requests = serve(() => new Response(null, { status: 204 }));
  const sdk = macro();

  await sdk.notifications.send({
    title: '3 new leads',
    link: sdk.agentSessions.byId('session-1'),
  });

  expect(await requests[0].json()).toEqual({
    title: '3 new leads',
    link: { entityType: 'agent_session', entityId: 'session-1' },
  });
});

test('a recipient who cannot see the link is refused', async () => {
  serve(() =>
    Response.json(
      { message: 'the recipient cannot see the linked entity' },
      { status: 403 },
    ),
  );
  const sdk = macro();

  const sending = sdk.notifications.send({
    title: 'Look at this',
    link: sdk.documents.byId('doc-1'),
    to: sdk.users.byId('macro|outsider@example.com'),
  });

  await expect(sending).rejects.toBeInstanceOf(MacroApiError);
});

test('a link to an entity notifications cannot open is rejected before sending', async () => {
  const requests = serve(() => new Response(null, { status: 204 }));
  const sdk = macro();

  const sending = sdk.notifications.send({
    title: 'Look at this',
    link: sdk.users.byId('macro|teammate@example.com') as never,
  });

  await expect(sending).rejects.toBeInstanceOf(TypeError);
  expect(requests).toHaveLength(0);
});

test('a form link names its entity type', async () => {
  const requests = serve(() => new Response(null, { status: 204 }));
  const sdk = macro();

  await sdk.notifications.send({
    title: 'New response',
    link: sdk.forms.byId('form-1'),
  });

  expect(await requests[0].json()).toEqual({
    title: 'New response',
    link: { entityType: 'form', entityId: 'form-1' },
  });
});
