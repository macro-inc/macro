import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPopoverSplit: vi.fn(),
  manager: true,
  trackMention: vi.fn(),
  untrackMention: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () =>
    mocks.manager ? { createPopoverSplit: mocks.createPopoverSplit } : null,
}));
vi.mock('@core/signal/mention', () => ({
  trackMention: mocks.trackMention,
  untrackMention: mocks.untrackMention,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));

const { insertTaskMention, openSnippetTaskComposer } = await import(
  './snippet-task-composer'
);

beforeEach(() => {
  mocks.createPopoverSplit.mockReset();
  mocks.manager = true;
  mocks.trackMention.mockReset();
  mocks.untrackMention.mockReset();
  mocks.untrackMention.mockResolvedValue(undefined);
  mocks.failure.mockReset();
});

const location = {
  type: 'persistent' as const,
  anchor: { id: 'a', offset: 0 },
  focus: { id: 'b', offset: 3 },
};

test('opens the task composer on the snippet with Source params', () => {
  const opened = openSnippetTaskComposer({
    blockId: 'doc-1',
    documentName: 'Plan',
    snippet: { text: '  buy   milk\ntoday ', location, end: 'end' },
    canEdit: true,
    linkTask: async () => null,
  });
  expect(opened).toBe(true);
  const params = mocks.createPopoverSplit.mock.calls[0][0].content.params;
  expect(mocks.createPopoverSplit.mock.calls[0][0].content.id).toBe(
    'task-compose'
  );
  expect(params.initialTitle).toBe('buy milk today');
  expect(params.initialContent).toContain('doc-1');
  expect(params.linkInSource.label).toBe('Link in document');
});

test('long snippets are cut to 70 characters and read-only drops the link', () => {
  openSnippetTaskComposer({
    blockId: 'doc-1',
    documentName: 'Plan',
    snippet: { text: 'x'.repeat(80), location, end: 'end' },
    canEdit: false,
    linkTask: async () => null,
  });
  const params = mocks.createPopoverSplit.mock.calls[0][0].content.params;
  expect(params.initialTitle).toBe(`${'x'.repeat(70)}...`);
  expect(params.linkInSource).toBeUndefined();
});

test('no split manager opens nothing', () => {
  mocks.manager = false;
  expect(
    openSnippetTaskComposer({
      blockId: 'doc-1',
      documentName: 'Plan',
      snippet: { text: 'x', location, end: 'end' },
      canEdit: true,
      linkTask: async () => null,
    })
  ).toBe(false);
});

test('Create More links each task after the previous one, in creation order', async () => {
  const points: string[] = [];
  openSnippetTaskComposer({
    blockId: 'doc-1',
    documentName: 'Plan',
    snippet: { text: 'x', location, end: 'end' },
    canEdit: true,
    linkTask: async (point, task) => {
      points.push(`${point}->${task.documentId}`);
      return task.documentId;
    },
  });
  const params = mocks.createPopoverSplit.mock.calls[0][0].content.params;
  params.linkInSource.insert({ documentId: 'one', title: 'One' });
  params.linkInSource.insert({ documentId: 'two', title: 'Two' });
  await vi.waitFor(() => expect(points).toHaveLength(2));
  expect(points).toEqual(['end->one', 'one->two']);
});

test('insertTaskMention tracks, inserts, and untracks a failed insert', async () => {
  mocks.trackMention.mockResolvedValue('uuid-1');
  const insert = vi.fn(() => null);
  await expect(
    insertTaskMention('doc-1', 'p', { documentId: 't', title: 'T' }, insert)
  ).resolves.toBeNull();
  expect(insert).toHaveBeenCalledWith('p', {
    documentId: 't',
    documentName: 'T',
    mentionUuid: 'uuid-1',
  });
  expect(mocks.failure).toHaveBeenCalledWith(
    'Could not link the task in this document'
  );
  expect(mocks.untrackMention).toHaveBeenCalledWith(
    'doc-1',
    'uuid-1',
    'document'
  );
});

test('a tracking failure still links the mention without a uuid', async () => {
  mocks.trackMention.mockRejectedValue(new Error('offline'));
  const next = await insertTaskMention(
    'doc-1',
    'p',
    { documentId: 't', title: 'T' },
    (_point, mention) => (mention.mentionUuid === undefined ? 'next' : null)
  );
  expect(next).toBe('next');
  expect(mocks.failure).not.toHaveBeenCalled();
});
