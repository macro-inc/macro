import { afterEach, expect, test } from 'bun:test';
import {
  CanvasEditRejectedError,
  CanvasRenderImage,
  CanvasRevisionConflictError,
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
    hosts: {
      storage: 'https://storage.example.test',
      'static-files': 'https://static.example.test',
    },
  });

const REVISION = 'a'.repeat(64);

function answer(status: number, body: unknown) {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return Response.json(body, { status });
  }) as typeof fetch;
  return requests;
}

test('scene reads the live scene with the items and format asked for', async () => {
  const scene = {
    rootId: 'root',
    totalItems: 2,
    matchedItems: 1,
    truncated: false,
    items: [{ id: 'box', type: 'rectangle', text: 'Risk' }],
    revision: REVISION,
  };
  const requests = answer(200, { revision: REVISION, scene });

  const result = await macro()
    .documents.byId('canvas-1')
    .canvas()
    .scene({ items: ['box'], format: 'scene' });

  expect(result).toEqual(scene);
  expect(requests[0].method).toBe('POST');
  expect(new URL(requests[0].url).pathname).toBe(
    '/documents/canvas-1/canvas/scene',
  );
  expect(await requests[0].json()).toEqual({
    itemIds: ['box'],
    format: 'scene',
  });
});

test('apply sends the code against its revision and returns the new scene', async () => {
  const after = {
    rootId: 'root',
    totalItems: 1,
    matchedItems: 1,
    truncated: false,
    items: [{ id: 'box', type: 'rectangle' }],
    revision: 'b'.repeat(64),
    textLayout: [],
  };
  const requests = answer(200, {
    operationsApplied: 1,
    revision: 'b'.repeat(64),
    scene: after,
    summary: 'Applied 1 acknowledged Canvas operations.',
  });

  const result = await macro()
    .documents.byId('canvas-1')
    .canvas()
    .apply("editor.move(['box'], 0, 40)", {
      expectedRevision: REVISION,
      snippets: { label: 'Ready' },
    });

  expect(result).toEqual({
    operationsApplied: 1,
    scene: after,
    summary: 'Applied 1 acknowledged Canvas operations.',
  });
  expect(new URL(requests[0].url).pathname).toBe(
    '/documents/canvas-1/canvas/edits',
  );
  expect(await requests[0].json()).toEqual({
    expectedRevision: REVISION,
    code: "editor.move(['box'], 0, 40)",
    snippets: { label: 'Ready' },
  });
});

test('apply says whether a failed batch committed anything', async () => {
  const canvas = macro().documents.byId('canvas-1').canvas();
  const batch = () =>
    canvas.apply("editor.move(['box'], 0, 40)", {
      expectedRevision: REVISION,
    });

  answer(409, {
    error: 'revision_conflict',
    message: 'Canvas revision changed.',
  });
  await expect(batch()).rejects.toBeInstanceOf(CanvasRevisionConflictError);

  answer(422, {
    error: 'edit_rejected',
    message: 'Item box no longer exists.',
  });
  const rejected = batch();
  await expect(rejected).rejects.toBeInstanceOf(CanvasEditRejectedError);
  await expect(rejected).rejects.toMatchObject({
    message: 'Item box no longer exists.',
  });

  answer(502, { error: 'edit_failed', message: 'may have partly applied' });
  await expect(batch()).rejects.toBeInstanceOf(EditOutcomeUnknownError);
});

test('edit sends instructions and keeps a partial clarification', async () => {
  const requests = answer(200, {
    operationsApplied: 2,
    summary: 'Moved one box.',
    clarification: 'Which colour for the other?',
  });

  const result = await macro()
    .documents.byId('canvas-1')
    .canvas()
    .edit('Line the boxes up.');

  expect(result).toEqual({
    operationsApplied: 2,
    summary: 'Moved one box.',
    webUrl: 'https://macro.com/app/md/canvas-1',
    clarification: 'Which colour for the other?',
  });
  expect(new URL(requests[0].url).pathname).toBe(
    '/documents/canvas-1/canvas/ai-edit',
  );
  expect(await requests[0].json()).toEqual({
    instructions: 'Line the boxes up.',
  });
});

test('a refused canvas edit raises the editor reason', async () => {
  answer(422, { error: 'edit_refused', message: 'Which of the two boxes?' });

  const edit = macro()
    .documents.byId('canvas-1')
    .canvas()
    .edit('Line the boxes up.');

  await expect(edit).rejects.toBeInstanceOf(DocumentEditRefusedError);
  await expect(edit).rejects.toMatchObject({
    reason: 'Which of the two boxes?',
  });
});

test('an aborted signal rejects before any canvas write is sent', async () => {
  const requests = answer(200, {});
  const controller = new AbortController();
  controller.abort();
  const canvas = macro().documents.byId('canvas-1').canvas();

  await expect(
    canvas.edit('Line the boxes up.', { signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  await expect(
    canvas.apply('editor.delete([])', {
      expectedRevision: REVISION,
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(requests).toHaveLength(0);
});

test('render returns a static image that maps onto the canvas', async () => {
  const crop = { x: 0, y: 0, width: 100, height: 80 };
  const objects = [
    { id: 'box', bounds: { x: 0, y: 0, width: 10, height: 10 } },
  ];
  const requests = answer(200, {
    fileId: '0199d6b2-7c8e-7b0e-9a6f-3c2f4a1b5d6e',
    url: 'https://static.example.test/file/0199d6b2-7c8e-7b0e-9a6f-3c2f4a1b5d6e',
    revision: REVISION,
    crop,
    width: 200,
    height: 160,
    objects,
    unavailable: [],
    textLayout: [],
  });

  const image = await macro()
    .documents.byId('canvas-1')
    .canvas()
    .render({ items: ['box'] });

  expect(image).toBeInstanceOf(CanvasRenderImage);
  expect(image.toJSON()).toEqual({
    id: '0199d6b2-7c8e-7b0e-9a6f-3c2f4a1b5d6e',
    url: 'https://static.example.test/file/0199d6b2-7c8e-7b0e-9a6f-3c2f4a1b5d6e',
    width: 200,
    height: 160,
    revision: REVISION,
    crop,
    objects,
    unavailable: [],
    textLayout: [],
  });
  expect(new URL(requests[0].url).pathname).toBe(
    '/documents/canvas-1/canvas/render',
  );
  expect(await requests[0].json()).toEqual({ itemIds: ['box'] });
});
