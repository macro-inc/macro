import { afterEach, expect, test } from 'bun:test';
import {
  DocumentChangedError,
  DocumentTooLargeError,
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

test('contentWithRevision reads the body with its revision', async () => {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return Response.json({
      markdown: '# Plan\n\nShip the beta.',
      revision: 'AQID',
    });
  }) as typeof fetch;

  const read = await macro().documents.byId('doc-1').contentWithRevision();

  expect(read).toEqual({
    markdown: '# Plan\n\nShip the beta.',
    revision: 'AQID',
  });
  expect(requests[0].method).toBe('GET');
  expect(new URL(requests[0].url).pathname).toBe('/documents/doc-1/markdown');
});

test('setContent writes the body against the revision it read', async () => {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return Response.json({ revision: 'AQIE', changed: true });
  }) as typeof fetch;

  const written = await macro()
    .documents.byId('doc-1')
    .setContent('# Plan\n\nShip the beta on Friday.', {
      expectedRevision: 'AQID',
    });

  expect(written).toEqual({ revision: 'AQIE', changed: true });
  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe('PUT');
  expect(new URL(requests[0].url).pathname).toBe('/documents/doc-1/markdown');
  expect(await requests[0].json()).toEqual({
    markdown: '# Plan\n\nShip the beta on Friday.',
    expectedRevision: 'AQID',
  });
});

test('a document changed since the read raises DocumentChangedError', async () => {
  globalThis.fetch = (async (_input) =>
    Response.json(
      {
        error: 'revision_conflict',
        message: 'The document changed since it was read; nothing was written.',
      },
      { status: 409 },
    )) as typeof fetch;

  await expect(
    macro()
      .documents.byId('doc-1')
      .setContent('Ship the release.', { expectedRevision: 'AQID' }),
  ).rejects.toBeInstanceOf(DocumentChangedError);
});

test('a document over the snapshot limit raises DocumentTooLargeError once, not an unknown outcome', async () => {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return Response.json(
      {
        error: 'document_too_large',
        message: 'The document exceeds the 4 MiB snapshot limit.',
      },
      { status: 413 },
    );
  }) as typeof fetch;
  const document = macro().documents.byId('doc-1');

  const write = await document
    .setContent('Ship the release.', { expectedRevision: 'AQID' })
    .catch((error: unknown) => error);
  const read = await document
    .contentWithRevision()
    .catch((error: unknown) => error);

  expect(write).toBeInstanceOf(DocumentTooLargeError);
  expect(write).not.toBeInstanceOf(EditOutcomeUnknownError);
  expect(read).toBeInstanceOf(DocumentTooLargeError);
  expect(requests.map((request) => request.method)).toEqual(['PUT', 'GET']);
});

test('a write with an unknown outcome is not reported as a conflict', async () => {
  globalThis.fetch = (async (_input) =>
    Response.json(
      { error: 'write_failed', message: 'read before retrying' },
      { status: 502 },
    )) as typeof fetch;

  await expect(
    macro()
      .documents.byId('doc-1')
      .setContent('Ship the release.', { expectedRevision: 'AQID' }),
  ).rejects.toBeInstanceOf(EditOutcomeUnknownError);
});
