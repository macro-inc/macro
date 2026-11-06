import { afterEach, expect, test } from 'bun:test';
import { Document } from '../src/entities/documents/document';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const macro = () =>
  new Macro({
    token: 'test-user-token',
    hosts: { storage: 'https://storage.example.test' },
  });

/** Record each request and answer it with `body`. */
function respondWith(body: unknown): Request[] {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return Response.json(body);
  }) as typeof fetch;
  return requests;
}

function target(request: Request): string {
  const url = new URL(request.url);
  return `${request.method} ${url.pathname}${url.search}`;
}

test('readPresentation reads the requested slides as text', async () => {
  const requests = respondWith({ content: 'Presentation: 3 slides' });

  const content = await macro()
    .documents.byId('deck-1')
    .readPresentation({ slides: [2, 3] });

  expect(content).toBe('Presentation: 3 slides');
  expect(requests.map(target)).toEqual([
    'GET /documents/deck-1/presentation?slide=2&slide=3',
  ]);
});

test('editPresentation sends the operations and returns what changed', async () => {
  const requests = respondWith({
    documentId: 'deck-1',
    created: [{ slide: 257 }],
    structureChanged: true,
    changedSlides: 'Slide 2 (id 257): Appendix',
  });

  const outcome = await macro()
    .documents.byId('deck-1')
    .editPresentation([
      { op: 'setText', slide: 256, shape: 2, text: 'Quarterly results' },
      { op: 'addSlide', after: 256, title: 'Appendix' },
    ]);

  expect(outcome).toEqual({
    created: [{ slide: 257 }],
    structureChanged: true,
    changedSlides: 'Slide 2 (id 257): Appendix',
  });
  expect(requests.map(target)).toEqual([
    'POST /documents/deck-1/presentation/edits',
  ]);
  expect(await requests[0].json()).toEqual({
    operations: [
      { op: 'setText', slide: 256, shape: 2, text: 'Quarterly results' },
      { op: 'addSlide', after: 256, title: 'Appendix' },
    ],
  });
});

test('copyPresentation creates the edited copy and returns its handle', async () => {
  const requests = respondWith({
    documentId: 'deck-2',
    created: [],
    structureChanged: false,
    changedSlides: 'Slide 1 (id 256): Résultats',
  });
  const client = macro();
  const project = client.projects.byId('project-1');

  const copy = await client.documents
    .byId('deck-1')
    .copyPresentation('Results (French)', {
      project,
      operations: [{ op: 'setText', slide: 256, shape: 2, text: 'Résultats' }],
    });

  expect(copy.document).toBeInstanceOf(Document);
  expect(copy.document.id).toBe('deck-2');
  expect(copy.changedSlides).toBe('Slide 1 (id 256): Résultats');
  expect(requests.map(target)).toEqual([
    'POST /documents/deck-1/presentation/copy',
  ]);
  expect(await requests[0].json()).toEqual({
    name: 'Results (French)',
    projectId: 'project-1',
    operations: [{ op: 'setText', slide: 256, shape: 2, text: 'Résultats' }],
  });
});

test('readWord pages the live document', async () => {
  const requests = respondWith({ content: 'Word document with 12 blocks.' });

  const content = await macro()
    .documents.byId('contract-1')
    .readWord({ start: 3, count: 10 });

  expect(content).toBe('Word document with 12 blocks.');
  expect(requests.map(target)).toEqual([
    'GET /documents/contract-1/word?start=3&count=10',
  ]);
});

test('editWord sends the operations and tracked-change options', async () => {
  const requests = respondWith({ content: 'p3: Payment is due in 30 days.' });

  const changed = await macro()
    .documents.byId('contract-1')
    .editWord(
      [
        {
          type: 'replaceText',
          paragraph: 'p3',
          find: '60 days',
          replace: '30 days',
        },
      ],
      { trackChanges: true },
    );

  expect(changed).toBe('p3: Payment is due in 30 days.');
  expect(requests.map(target)).toEqual([
    'POST /documents/contract-1/word/edits',
  ]);
  expect(await requests[0].json()).toEqual({
    operations: [
      {
        type: 'replaceText',
        paragraph: 'p3',
        find: '60 days',
        replace: '30 days',
      },
    ],
    trackChanges: true,
  });
});

test('design files are read as text', async () => {
  const requests = respondWith({ content: 'Design: 2 pages' });
  const document = macro().documents.byId('file-1');

  await document.readDesign({ pages: [2] });
  await document.readPhotoshop();
  await document.readIllustrator();

  expect(requests.map(target)).toEqual([
    'GET /documents/file-1/design?page=2',
    'GET /documents/file-1/photoshop',
    'GET /documents/file-1/illustrator',
  ]);
});
