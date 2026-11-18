import { afterEach, expect, test } from 'bun:test';
import {
  DocumentEditRefusedError,
  EditOutcomeUnknownError,
  Macro,
} from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const macro = () =>
  new Macro({
    token: 'test-user-token',
    hosts: { storage: 'https://storage.example.test' },
  });

test('edit sends the instructions and returns the revision', async () => {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return Response.json({ revision: 'AQID' });
  }) as typeof fetch;

  const result = await macro()
    .documents.byId('doc-1')
    .edit('Replace "Q3" with "Q4" in the "Timeline" section.', { fast: true });

  expect(result).toEqual({
    revision: 'AQID',
    webUrl: 'https://macro.com/app/md/doc-1',
  });
  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe('POST');
  expect(new URL(requests[0].url).pathname).toBe('/documents/doc-1/ai-edit');
  expect(await requests[0].json()).toEqual({
    instructions: 'Replace "Q3" with "Q4" in the "Timeline" section.',
    fast: true,
  });
});

test('a refused edit raises the editor reason', async () => {
  globalThis.fetch = (async (_input) =>
    Response.json(
      {
        error: 'edit_refused',
        reason: 'There is no section called "Risks".',
      },
      { status: 422 },
    )) as typeof fetch;

  const edit = macro().documents.byId('doc-1').edit('Shorten "Risks".');

  await expect(edit).rejects.toBeInstanceOf(DocumentEditRefusedError);
  await expect(edit).rejects.toMatchObject({
    reason: 'There is no section called "Risks".',
  });
});

test('an edit with an unknown outcome is not reported as refused', async () => {
  globalThis.fetch = (async (_input) =>
    Response.json(
      { error: 'edit_failed', message: 'worker unavailable' },
      { status: 502 },
    )) as typeof fetch;

  await expect(
    macro().documents.byId('doc-1').edit('Shorten "Risks".'),
  ).rejects.toBeInstanceOf(EditOutcomeUnknownError);
});

test('an aborted signal rejects before any request is sent', async () => {
  let count = 0;
  globalThis.fetch = (async (_input) => {
    count++;
    return Response.json({});
  }) as typeof fetch;
  const controller = new AbortController();
  controller.abort();

  await expect(
    macro()
      .documents.byId('doc-1')
      .edit('Shorten "Risks".', { signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(count).toBe(0);
});

test('aborting an edit in flight cancels its request', async () => {
  let started: (signal: AbortSignal) => void = () => {};
  const requestSignal = new Promise<AbortSignal>((resolve) => {
    started = resolve;
  });
  globalThis.fetch = ((input: Request | string, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    started(request.signal);
    return new Promise<Response>((_, reject) =>
      request.signal.addEventListener('abort', () =>
        reject(request.signal.reason),
      ),
    );
  }) as typeof fetch;
  const controller = new AbortController();

  const edit = macro()
    .documents.byId('doc-1')
    .edit('Shorten "Risks".', { signal: controller.signal });
  const signal = await requestSignal;
  controller.abort();

  await expect(edit).rejects.toMatchObject({ name: 'AbortError' });
  expect(signal.aborted).toBe(true);
});

test('a timed-out or broken edit is reported as an unknown outcome', async () => {
  globalThis.fetch = (async (_input) =>
    Response.json({ message: 'timed out' }, { status: 504 })) as typeof fetch;
  await expect(
    macro().documents.byId('doc-1').edit('Shorten "Risks".'),
  ).rejects.toMatchObject({ name: 'EditOutcomeUnknownError', status: 504 });

  globalThis.fetch = (async (_input): Promise<Response> => {
    throw new TypeError('connection reset');
  }) as typeof fetch;
  await expect(
    macro().documents.byId('doc-1').edit('Shorten "Risks".'),
  ).rejects.toMatchObject({ name: 'EditOutcomeUnknownError', status: 0 });
});

test('a partial edit returns the clarification', async () => {
  globalThis.fetch = (async (_input) =>
    Response.json({
      revision: 'AQID',
      clarification: 'Which of the two plans?',
    })) as typeof fetch;

  expect(await macro().documents.byId('doc-1').edit('Fix both plans.')).toEqual(
    {
      revision: 'AQID',
      webUrl: 'https://macro.com/app/md/doc-1',
      clarification: 'Which of the two plans?',
    },
  );
});
