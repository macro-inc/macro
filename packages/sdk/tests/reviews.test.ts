import { afterEach, describe, expect, test } from 'bun:test';
import type { ReviewRecord } from '../generated/agent-harness/types.gen';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const executionId = '0198a4cc-e138-7670-a308-a6b766602788';
const fixture: ReviewRecord = {
  id: '0198a4cc-e138-7670-a308-a6b766602799',
  sessionId: '0198a4cc-e138-7670-a308-a6b766602700',
  executionId,
  kind: 'email',
  title: 'Draft',
  revision: 0,
  updatedAt: 0,
  items: [
    {
      id: '0198a4cc-e138-7670-a308-a6b766602777',
      draft: {
        subject: 'Review',
        body: 'Draft body',
        to: [{ email: 'recipient@example.test' }],
      },
      status: 'pending',
      result: null,
      error: null,
    },
  ],
};
function setup() {
  const requests: Array<{ request: Request; body: unknown }> = [];
  globalThis.fetch = (async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const body: unknown =
      request.method === 'POST' ? await request.clone().json() : undefined;
    requests.push({ request, body });
    const list = request.method === 'GET' && request.url.endsWith('/reviews');
    return Response.json(list ? [fixture] : fixture);
  }) as typeof fetch;
  const macro = new Macro({
    token: 'test-token',
    hosts: { 'agent-harness': 'https://agent.example.test' },
  });
  const session = macro.agentSessions.byId(fixture.sessionId);
  return {
    session,
    execution: session.codeExecutions.byId(executionId),
    requests,
  };
}
describe('persistent review handles', () => {
  test('creation attaches execution identity and returns a hydrated reference', async () => {
    const { execution, requests } = setup();
    const review = await execution.reviews.create({
      kind: 'email',
      title: 'Draft',
      drafts: [
        {
          subject: 'Review',
          body: 'Draft body',
          to: [{ email: 'recipient@example.test' }],
        },
      ],
    });
    expect(await review.reference()).toEqual({
      kind: 'email',
      id: fixture.id,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toMatchObject({
      executionId: execution.id,
      kind: 'email',
    });
    expect(requests[0].request.headers.get('authorization')).toBe(
      'Bearer test-token',
    );
  });
  test('session reviews can be presented without a code execution', async () => {
    const { session, requests } = setup();
    const review = await session.reviews.create({
      kind: 'email',
      title: 'Draft',
      drafts: [
        {
          subject: 'Review',
          body: 'Draft body',
          to: [{ email: 'recipient@example.test' }],
        },
      ],
    });
    expect(await review.reference()).toEqual({
      kind: 'email',
      id: fixture.id,
    });
    expect(requests[0].body).toMatchObject({
      executionId: null,
      kind: 'email',
    });
    expect(requests[0].request.url).toContain(
      `/agent-sessions/${session.id}/reviews`,
    );
  });
  test('items scope edits and submissions to the saved revision and session', async () => {
    const { session, requests } = setup();
    const review = session.reviews.byId(fixture.id);
    expect(requests).toHaveLength(0);
    const [item] = await review.items();
    await item.edit({
      subject: 'Updated subject',
      body: 'Updated draft',
      to: [{ email: 'recipient@example.test' }],
    });
    expect(requests[1].body).toEqual({
      action: 'edit',
      revision: 0,
      item: item.id,
      draft: {
        subject: 'Updated subject',
        body: 'Updated draft',
        to: [{ email: 'recipient@example.test' }],
      },
    });
    expect(requests[1].request.url).toContain(
      `/agent-sessions/${session.id}/reviews/${fixture.id}`,
    );
    await item.submit();
    expect(requests.at(-1)?.body).toEqual({
      action: 'submit',
      revision: 0,
      items: [item.id],
    });
  });
  test('lists fresh review handles without embedding drafts in the returned reference', async () => {
    const { execution, requests } = setup();
    const [review] = await execution.reviews.list();
    expect(await review.reference()).toEqual({
      kind: 'email',
      id: fixture.id,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].request.url).toContain(
      `/code-executions/${execution.id}/reviews`,
    );
  });
  test('a revision conflict is surfaced without an automatic retry', async () => {
    const { session, requests } = setup();
    const review = session.reviews.byId(fixture.id);
    await review.items();
    let attempts = 0;
    globalThis.fetch = (async (_input) => {
      attempts++;
      return new Response('Review changed', { status: 409 });
    }) as typeof fetch;
    await expect(review.submitAll()).rejects.toThrow();
    expect(attempts).toBe(1);
    expect(requests).toHaveLength(1);
  });
});
