import { afterEach, expect, test } from 'bun:test';
import { Macro, type StructuredCompletionResponse } from '../src/macro';
import { MacroApiError } from '../src/utils';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const macro = () =>
  new Macro({
    token: 'user-token',
    hosts: { cognition: 'https://cognition.example.test' },
  });

test('shared AI endpoints preserve request, auth and complete result contracts', async () => {
  const requests: Request[] = [];
  const completion: StructuredCompletionResponse = {
    outcome: { status: 'interrupted', reason: 'provider unavailable' },
    toolActivity: [
      {
        name: 'AddColumn',
        outcome: { status: 'succeeded', changes: { kind: 'schema' } },
      },
    ],
  };
  globalThis.fetch = (async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    requests.push(request);
    return Response.json(
      request.url.endsWith('/decisions')
        ? { probabilities: { urgent: 0.7 } }
        : completion,
    );
  }) as typeof fetch;
  const request = {
    prompt: 'Summarize supplied facts',
    model: 'google/test-model',
    output_schema: { name: 'Summary', schema: { type: 'object' } },
    toolset: { type: 'none' as const },
  };
  await expect(macro().ai.structuredCompletion(request)).resolves.toEqual(
    completion,
  );
  const decision = {
    input: { subject: 'Invoice due tomorrow' },
    questions: { urgent: 'Is there a deadline?' },
  };
  await expect(macro().ai.decide(decision)).resolves.toEqual({
    probabilities: { urgent: 0.7 },
  });
  expect(requests.map((r) => [r.method, r.url])).toEqual([
    ['POST', 'https://cognition.example.test/structured-completion'],
    ['POST', 'https://cognition.example.test/decisions'],
  ]);
  expect(await requests[0].json()).toEqual(request);
  expect(await requests[1].json()).toEqual(decision);
  expect(
    requests.every(
      (r) => r.headers.get('authorization') === 'Bearer user-token',
    ),
  ).toBe(true);
});

test('AI allowance and unavailable responses remain explicit API errors', async () => {
  for (const status of [402, 503]) {
    globalThis.fetch = (async (_input) =>
      Response.json(
        { error: 'unavailable', code: 'test' },
        { status },
      )) as typeof fetch;
    const error = await macro()
      .ai.decide({
        input: 'hello',
        questions: { greeting: 'Is this a greeting?' },
      })
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(MacroApiError);
    expect((error as MacroApiError).status).toBe(status);
  }
});
