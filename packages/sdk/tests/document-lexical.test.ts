import { afterEach, expect, test } from 'bun:test';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isParagraphNode,
  type SerializedEditorState,
} from 'lexical';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  $getId,
  $isListItemNode,
  $isTaskListNode,
  $setId,
  $updateAllNodeIds,
  ALL_TRANSFORMERS,
  createDocumentEditor,
} from '../src/lexical';
import {
  DocumentEditConflictError,
  DocumentEditInvalidError,
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

function stateOf(markdown: string): SerializedEditorState {
  const editor = createDocumentEditor();
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, ALL_TRANSFORMERS);
      $updateAllNodeIds({
        idToNodeKeyMap: new Map(),
        nodeKeyToIdMap: new Map(),
      });
    },
    { discrete: true },
  );
  return editor.getEditorState().toJSON();
}

const plan = stateOf('# Plan\n\n- [ ] draft\n- [ ] ship\n\nNotes');
const blockIds = plan.root.children.map((node) => String(node.$?.id));

/** Serve the read, then each commit response in turn; record every request. */
function serve(...commits: Response[]) {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    if (request.method === 'GET')
      return Response.json({ state: plan, revision: 'base-revision' });
    const response = commits.shift();
    if (!response) throw new Error('unexpected commit');
    return response;
  }) as typeof fetch;
  return requests;
}

test('lexical() loads the document into an editor at its revision', async () => {
  const requests = serve();
  const lexical = await macro().documents.byId('doc-1').lexical();

  expect(lexical.revision).toBe('base-revision');
  expect(lexical.read(() => $convertToMarkdownString(ALL_TRANSFORMERS))).toBe(
    '# Plan\n\n- [ ] draft\n- [ ] ship\n\nNotes',
  );
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0].url).pathname).toBe('/documents/doc-1/lexical');
});

test('commit sends the changed blocks and adopts the returned state', async () => {
  const merged = stateOf(
    '# Plan\n\n- [x] draft\n- [x] ship\n\nNotes by a peer',
  );
  const requests = serve(
    Response.json({ state: merged, revision: 'after-commit' }),
  );
  const lexical = await macro().documents.byId('doc-1').lexical();

  lexical.update(() => {
    for (const block of $getRoot().getChildren()) {
      if (!$isTaskListNode(block)) continue;
      for (const item of block.getChildren())
        if ($isListItemNode(item)) item.setChecked(true);
    }
  });
  const result = await lexical.commit();

  expect(result).toEqual({
    revision: 'after-commit',
    webUrl: 'https://macro.com/app/md/doc-1',
  });
  expect(requests).toHaveLength(2);
  expect(requests[1].method).toBe('POST');
  const body = await requests[1].json();
  expect(body.revision).toBe('base-revision');
  expect(body.removed).toEqual([]);
  expect(body.blocks.map((block: { id: string }) => block.id)).toEqual([
    blockIds[1],
  ]);
  expect(body.blocks[0].after).toBe(blockIds[0]);
  expect(body.blocks[0].node.$.id).toBe(blockIds[1]);

  expect(lexical.revision).toBe('after-commit');
  expect(lexical.read(() => $convertToMarkdownString(ALL_TRANSFORMERS))).toBe(
    '# Plan\n\n- [x] draft\n- [x] ship\n\nNotes by a peer',
  );
  // The adopted state is the new base: nothing left to send.
  expect(await lexical.commit()).toEqual({
    revision: 'after-commit',
    webUrl: 'https://macro.com/app/md/doc-1',
  });
  expect(requests).toHaveLength(2);
});

test('an empty commit sends nothing and keeps the revision', async () => {
  const requests = serve();
  const lexical = await macro().documents.byId('doc-1').lexical();

  expect(await lexical.commit()).toEqual({
    revision: 'base-revision',
    webUrl: 'https://macro.com/app/md/doc-1',
  });
  expect(requests).toHaveLength(1);
});

test('nodes without ids get fresh ones, and copies of an id are renamed', async () => {
  const requests = serve(
    Response.json({ state: plan, revision: 'after-commit' }),
  );
  const lexical = await macro().documents.byId('doc-1').lexical();

  lexical.update(() => {
    const copy = $createParagraphNode().append($createTextNode('copy'));
    $setId(copy, blockIds[0]);
    $getRoot().append(
      $createParagraphNode().append($createTextNode('added')),
      copy,
    );
  });
  await lexical.commit();

  const body = await requests[1].json();
  expect(body.blocks).toHaveLength(2);
  const [added, copy] = body.blocks;
  expect(typeof added.id).toBe('string');
  expect(added.node.$.id).toBe(added.id);
  expect(added.after).toBe(blockIds[2]);
  expect(copy.id).not.toBe(blockIds[0]);
  expect(copy.after).toBe(added.id);
  expect(added.node.children[0].$.id).toEqual(expect.any(String));
});

test('a conflict raises DocumentEditConflictError and keeps the edit', async () => {
  serve(
    Response.json(
      {
        error: 'conflict',
        conflicts: [{ id: blockIds[2], reason: 'changed' }],
      },
      { status: 409 },
    ),
  );
  const lexical = await macro().documents.byId('doc-1').lexical();
  lexical.update(() => {
    const notes = $getRoot().getLastChild();
    if ($isParagraphNode(notes))
      notes.append($createTextNode(' and more notes'));
  });

  const commit = lexical.commit();
  await expect(commit).rejects.toBeInstanceOf(DocumentEditConflictError);
  await expect(commit).rejects.toMatchObject({
    status: 409,
    conflicts: [{ id: blockIds[2], reason: 'changed' }],
  });
  expect(lexical.revision).toBe('base-revision');
  expect(lexical.read(() => $getId($getRoot().getLastChildOrThrow()))).toBe(
    blockIds[2],
  );
});

test('an invalid commit raises DocumentEditInvalidError with the reason', async () => {
  serve(
    Response.json(
      { error: 'invalid', message: 'unknown node type "sparkle"' },
      { status: 422 },
    ),
  );
  const lexical = await macro().documents.byId('doc-1').lexical();
  lexical.update(() => {
    $getRoot().append($createParagraphNode());
  });

  const commit = lexical.commit();
  await expect(commit).rejects.toBeInstanceOf(DocumentEditInvalidError);
  await expect(commit).rejects.toMatchObject({
    reason: 'unknown node type "sparkle"',
  });
});

test('a commit with an unknown outcome raises EditOutcomeUnknownError', async () => {
  for (const response of [
    Response.json(
      { error: 'edit_outcome_unknown', message: 'no acknowledgement' },
      { status: 502 },
    ),
    Response.json({ message: 'timed out' }, { status: 504 }),
  ]) {
    serve(response);
    const lexical = await macro().documents.byId('doc-1').lexical();
    lexical.update(() => {
      $getRoot().append($createParagraphNode());
    });
    await expect(lexical.commit()).rejects.toMatchObject({
      name: 'EditOutcomeUnknownError',
      status: response.status,
    });
  }

  serve();
  const lexical = await macro().documents.byId('doc-1').lexical();
  globalThis.fetch = (async (_input): Promise<Response> => {
    throw new TypeError('connection reset');
  }) as typeof fetch;
  lexical.update(() => {
    $getRoot().append($createParagraphNode());
  });
  const commit = lexical.commit();
  await expect(commit).rejects.toBeInstanceOf(EditOutcomeUnknownError);
  await expect(commit).rejects.toMatchObject({ status: 0 });
});

test('an aborted signal rejects before the commit is sent', async () => {
  const requests = serve();
  const lexical = await macro().documents.byId('doc-1').lexical();
  lexical.update(() => {
    $getRoot().append($createParagraphNode());
  });
  const controller = new AbortController();
  controller.abort();

  await expect(
    lexical.commit({ signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(requests).toHaveLength(1);
});
