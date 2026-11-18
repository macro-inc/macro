/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { transfer } from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import { expect, onTestFinished, test, vi } from 'vitest';
import {
  mount,
  state,
} from '../../../../../../features/block-md/component/format-host/native-test-fixture';

// Only the upload service and mention tracking are replaced; the document
// body is a real mounted native session.
const service = vi.hoisted(() => ({
  uploads: [] as string[],
  tracked: [] as [string, string, string][],
  /** When set, tracking waits for the test to release it. */
  hold: undefined as PromiseWithResolvers<void> | undefined,
}));
vi.mock('@core/util/upload', async (original) => ({
  ...(await original<typeof import('@core/util/upload')>()),
  uploadFiles: async (entries: { name?: string; file?: File }[]) =>
    entries.map((entry) => {
      const name = entry.file?.name ?? entry.name ?? '';
      service.uploads.push(name);
      return {
        failed: false,
        destination: 'dss',
        type: 'document',
        fileType: 'pdf',
        name: 'report',
        documentId: 'uploaded-document-1',
      };
    }),
}));
vi.mock('@core/signal/mention', () => ({
  trackMention: async (source: string, kind: string, target: string) => {
    service.tracked.push([source, kind, target]);
    await service.hold?.promise;
    return 'mention-uuid-1';
  },
  untrackMention: async () => {},
}));
vi.mock('@core/mobile/mobileClipboardImageRecovery', () => ({
  shouldUseMobileClipboardImageRecovery: () => false,
  recoverMobileClipboardImageEntries: async () => [],
}));
vi.mock('../file-paste/desktopPasteboardFiles', () => ({
  shouldStageDesktopPasteFiles: () => false,
  stageDesktopPasteFiles: async () => [],
}));

const { createNativeImageUploadController } = await import(
  './native-image-upload'
);

test('pasting a PDF uploads it and inserts a tracked document mention, as Source filePastePlugin does', async () => {
  const runtime = mount();
  onTestFinished(() => runtime.root.remove());
  onTestFinished(() => runtime.close());
  runtime.port.setState(state('before'));
  const uploads = createNativeImageUploadController({
    mentionSourceId: () => 'source-document',
  });
  onTestFinished(() => uploads.dispose());
  uploads.bindView(runtime.view);
  const text = [...runtime.view.mirror.values()].find(
    (node) => node.kind === 'text'
  );
  if (!text) throw new Error('Missing actual native text');
  runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key: text.key, offset: 6, type: 'text' },
    focus: { key: text.key, offset: 6, type: 'text' },
  });
  const file = new File(['%PDF'], 'report.pdf', { type: 'application/pdf' });
  expect(
    await runtime.view.clipboard.paste(transfer('report.pdf', '', [file]))
  ).toBe(true);
  await vi.waitFor(() =>
    expect(runtime.executor.session.serializedState()).toContain(
      'uploaded-document-1'
    )
  );
  expect(service.uploads).toEqual(['report.pdf']);
  expect(service.tracked).toEqual([
    ['source-document', 'document', 'uploaded-document-1'],
  ]);
  const mention = JSON.parse(
    runtime.executor.session.serializedState()
  ).root.children[0].children.find(
    (node: { type: string }) => node.type === 'document-mention'
  );
  expect(mention).toMatchObject({
    documentId: 'uploaded-document-1',
    documentName: 'report',
    blockName: 'pdf',
    mentionUuid: 'mention-uuid-1',
  });
});

test('an upload owner disposed while the mention is being tracked inserts nothing', async () => {
  service.tracked.length = 0;
  service.hold = Promise.withResolvers<void>();
  onTestFinished(() => {
    service.hold = undefined;
  });
  const runtime = mount();
  onTestFinished(() => runtime.root.remove());
  onTestFinished(() => runtime.close());
  runtime.port.setState(state('before'));
  const uploads = createNativeImageUploadController({
    mentionSourceId: () => 'source-document',
  });
  onTestFinished(() => uploads.dispose());
  uploads.bindView(runtime.view);
  const file = new File(['%PDF'], 'report.pdf', { type: 'application/pdf' });
  expect(
    await runtime.view.clipboard.paste(transfer('report.pdf', '', [file]))
  ).toBe(true);
  await vi.waitFor(() => expect(service.tracked).toHaveLength(1));
  // The document's upload owner retires (view rebind or close) mid-tracking.
  uploads.dispose();
  const settled = vi.spyOn(runtime.port, 'inputSettledIfSessionEdit');
  service.hold?.resolve();
  // Drain the tracking continuation and the mention's admission check.
  for (let tick = 0; tick < 10; tick++) await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  expect(runtime.executor.session.serializedState()).not.toContain(
    'uploaded-document-1'
  );
});

/** A dropped file as fileFolderDrop hands it over. */
function droppedFile(file: File) {
  return {
    name: file.name,
    isFile: true,
    isDirectory: false,
    file: (resolve: (file: File) => void) => resolve(file),
  } as unknown as FileSystemFileEntry;
}

function dropFixture() {
  service.uploads.length = 0;
  const runtime = mount();
  onTestFinished(() => runtime.root.remove());
  onTestFinished(() => runtime.close());
  runtime.port.setState(state('before'));
  const uploads = createNativeImageUploadController({
    mentionSourceId: () => 'source-document',
  });
  onTestFinished(() => uploads.dispose());
  uploads.bindView(runtime.view);
  const block = runtime.view.node(0)?.children[0];
  if (block === undefined) throw new Error('Missing actual block');
  const admit = runtime.port.inputSettledIfSessionEdit.bind(runtime.port);
  const admissions = vi.spyOn(runtime.port, 'inputSettledIfSessionEdit');
  return { runtime, uploads, block, admit, admissions };
}

test('a drop whose placement meets a new view generation at entry places nothing and uploads nothing', async () => {
  const { runtime, uploads, block, admit, admissions } = dropFixture();
  const before = runtime.executor.session.serializedState();
  const original = runtime.view.mirror.keyGeneration;
  if (original === null) throw new Error('Missing actual generation');
  // The view is re-initialized (resync) after the drop queued its placement.
  admissions.mockImplementationOnce((...args) => {
    vi.spyOn(runtime.view.mirror, 'keyGeneration', 'get').mockReturnValue(
      original + 1
    );
    return admit(...args);
  });
  uploads.dropFiles([droppedFile(new File(['%PDF'], 'report.pdf'))], [], {
    key: block,
    position: 'after',
    domRect: new DOMRect(),
  });
  await vi.waitFor(() => expect(admissions).toHaveBeenCalledTimes(1));
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
  expect(admissions).toHaveBeenCalledTimes(1);
  expect(service.uploads).toEqual([]);
  expect(runtime.executor.session.serializedState()).toBe(before);
});

test('a drop whose target block is gone places nothing and uploads nothing', async () => {
  const { runtime, uploads, admissions } = dropFixture();
  const before = runtime.executor.session.serializedState();
  uploads.dropFiles([droppedFile(new File(['%PDF'], 'report.pdf'))], [], {
    key: 9999,
    position: 'before',
    domRect: new DOMRect(),
  });
  await vi.waitFor(() => expect(admissions).toHaveBeenCalledTimes(1));
  const placement = await admissions.mock.results[0]?.value;
  expect(placement).toMatchObject({ status: 'success', handled: false });
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
  expect(admissions).toHaveBeenCalledTimes(1);
  expect(service.uploads).toEqual([]);
  expect(runtime.executor.session.serializedState()).toBe(before);
});
