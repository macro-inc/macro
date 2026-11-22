/** @vitest-environment jsdom */
import { expect, test, vi } from 'vitest';

// Source timing controls for the shared upload and mention helpers. The tick
// counts are the ones the pre-refactor code (61f19e0ea10) produces; a change
// here is a Source behaviour change.
const TRACKED_TICKS = 1;
const AFTER_UPLOAD_TICKS = 3;
const service = vi.hoisted(() => ({ tracked: 0 }));
vi.mock('@core/signal/mention', () => ({
  trackMention: () => {
    service.tracked++;
    return Promise.resolve('mention-uuid');
  },
  untrackMention: async () => {},
}));
vi.mock('@core/util/upload', async (original) => ({
  ...(await original<typeof import('@core/util/upload')>()),
  uploadFiles: () =>
    Promise.resolve([
      {
        failed: false,
        destination: 'dss',
        type: 'document',
        fileType: 'pdf',
        name: 'report',
        documentId: 'uploaded-document-1',
      },
    ]),
}));

const { behaviorEditor } = await import('../behavior-inventory/editor');
const { handleBasicMention } = await import('./mentionsUtils');
const { createFilesReadyHandler } = await import('./fileUploadUtils');

const ITEM = {
  id: 'doc-1',
  name: 'Doc',
  type: 'document' as const,
  fileType: 'md',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  deletedAt: null,
  documentVersionId: 0,
  ownerId: '',
};

/** Microtasks from now until `done()` holds, bounded. */
async function ticksUntil(done: () => boolean) {
  let ticks = 0;
  while (!done() && ticks < 50) {
    await Promise.resolve();
    ticks++;
  }
  return ticks;
}

test('an untracked basic mention dispatches synchronously', () => {
  const dispatchCommand = vi.fn(() => true);
  const pending = handleBasicMention(ITEM, { editor: { dispatchCommand } });
  expect(dispatchCommand).toHaveBeenCalledTimes(1);
  return pending;
});

test('a tracked basic mention dispatches on the same tick as before', async () => {
  const dispatchCommand = vi.fn(() => true);
  const pending = handleBasicMention(ITEM, {
    editor: { dispatchCommand },
    blockId: 'source-doc',
  });
  expect(dispatchCommand).not.toHaveBeenCalled();
  const ticks = await ticksUntil(() => dispatchCommand.mock.calls.length > 0);
  await pending;
  expect({ ticks, tracked: service.tracked }).toEqual({
    ticks: TRACKED_TICKS,
    tracked: 1,
  });
});

test('afterFileUpload runs on the same tick as before', async () => {
  const afterFileUpload = vi.fn();
  const { editor } = behaviorEditor();
  const ready = createFilesReadyHandler(
    editor,
    undefined,
    undefined,
    undefined,
    afterFileUpload
  );
  const pending = ready([
    { file: new File(['%PDF'], 'report.pdf'), isFolder: false },
  ]);
  const ticks = await ticksUntil(() => afterFileUpload.mock.calls.length > 0);
  await pending;
  expect({ ticks, ids: afterFileUpload.mock.calls[0]?.[0] }).toEqual({
    ticks: AFTER_UPLOAD_TICKS,
    ids: ['uploaded-document-1'],
  });
});
