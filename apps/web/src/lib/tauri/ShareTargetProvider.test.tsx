import { createNativeShareSend } from '@app/features/sharing/native-share-sheet/createNativeShareSend';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type PendingShareFile,
  ShareTargetProvider,
  useShareTarget,
} from './ShareTargetProvider';

const invoke = vi.hoisted(() => vi.fn());
let setAndroidFiles: (files: PendingShareFile[]) => void;
let onIosFilesReady:
  | ((event: { payload: { filenames: string[] } }) => void)
  | undefined;
/** Files the Share Extension saved that the app hasn't taken yet. */
let nativePending: string[];

vi.mock('@tauri-apps/api/core', () => ({
  invoke,
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_name, listener) => {
    onIosFilesReady = listener;
    return Promise.resolve(vi.fn());
  }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: vi.fn() },
}));
vi.mock('./androidShares', () => ({
  useAndroidShares: (setFiles: (files: PendingShareFile[]) => void) => {
    setAndroidFiles = setFiles;
  },
}));

beforeEach(() => {
  onIosFilesReady = undefined;
  nativePending = [];
  invoke.mockReset();
  invoke.mockImplementation(async (command, args) => {
    if (command === 'get_pending_share_filenames') return [...nativePending];
    if (command === 'pop_shared_files') {
      const taken = args.filenames.filter((name: string) =>
        nativePending.includes(name)
      );
      nativePending = nativePending.filter((name) => !taken.includes(name));
      return taken.map((name: string) => ({
        token: name,
        name,
        mime_type: 'image/png',
        size: 3,
      }));
    }
  });
});

afterEach(cleanup);

function renderProvider(os: 'android' | 'ios') {
  let context: ReturnType<typeof useShareTarget>;
  function CaptureContext() {
    context = useShareTarget();
    return null;
  }
  render(() => (
    <ShareTargetProvider os={os}>
      <CaptureContext />
    </ShareTargetProvider>
  ));
  if (!context) throw new Error('Missing share target context');
  return context;
}

function pendingTokens(target: NonNullable<ReturnType<typeof useShareTarget>>) {
  return target.pendingShareFiles().map((file) => file.token);
}

function invokedCommands(command: string) {
  return invoke.mock.calls.filter(([name]) => name === command);
}

describe('iOS share loading', () => {
  it('picks up a waiting share when none is open', async () => {
    const target = renderProvider('ios');
    nativePending = ['share_unlinked.jpg'];

    await target.pickUpPendingShareFiles();

    expect(pendingTokens(target)).toEqual(['share_unlinked.jpg']);
  });

  it('never replaces an open share on pickup', async () => {
    const target = renderProvider('ios');
    nativePending = ['share_open.png'];
    await target.pickUpPendingShareFiles();

    nativePending = ['share_waiting.png'];
    await target.pickUpPendingShareFiles();

    expect(pendingTokens(target)).toEqual(['share_open.png']);
    expect(nativePending).toEqual(['share_waiting.png']);
    expect(invokedCommands('clear_shared_files')).toEqual([]);
  });

  it('replaces the open share when a new link arrives', async () => {
    const target = renderProvider('ios');
    await vi.waitFor(() => expect(onIosFilesReady).toBeDefined());
    nativePending = ['share_first.png'];
    onIosFilesReady?.({ payload: { filenames: ['share_first.png'] } });
    await vi.waitFor(() =>
      expect(pendingTokens(target)).toEqual(['share_first.png'])
    );

    nativePending = ['share_second.png'];
    onIosFilesReady?.({ payload: { filenames: ['share_second.png'] } });

    await vi.waitFor(() =>
      expect(pendingTokens(target)).toEqual(['share_second.png'])
    );
    expect(invokedCommands('clear_shared_files')).toEqual([
      ['clear_shared_files', { tokens: ['share_first.png'] }],
    ]);
  });

  it('finishes links in the order they arrived', async () => {
    const target = renderProvider('ios');
    await vi.waitFor(() => expect(onIosFilesReady).toBeDefined());
    const firstPop = Promise.withResolvers<void>();
    invoke.mockImplementation(async (command, args) => {
      if (command !== 'pop_shared_files') return;
      // The older link's files take longer to stage than the newer link's.
      if (args.filenames[0] === 'share_older.png') await firstPop.promise;
      return args.filenames.map((name: string) => ({
        token: name,
        name,
        mime_type: 'image/png',
        size: 3,
      }));
    });

    onIosFilesReady?.({ payload: { filenames: ['share_older.png'] } });
    onIosFilesReady?.({ payload: { filenames: ['share_newer.png'] } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    firstPop.resolve();

    await vi.waitFor(() =>
      expect(invokedCommands('pop_shared_files')).toHaveLength(2)
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pendingTokens(target)).toEqual(['share_newer.png']);
  });

  it('loads only the files a link names, never an older waiting share', async () => {
    const target = renderProvider('ios');
    await vi.waitFor(() => expect(onIosFilesReady).toBeDefined());
    nativePending = ['share_waiting.png', 'share_linked.png'];

    onIosFilesReady?.({ payload: { filenames: ['share_linked.png'] } });
    await vi.waitFor(() =>
      expect(pendingTokens(target)).toEqual(['share_linked.png'])
    );
    // The same link again finds its files gone and changes nothing.
    onIosFilesReady?.({ payload: { filenames: ['share_linked.png'] } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(pendingTokens(target)).toEqual(['share_linked.png']);
    expect(nativePending).toEqual(['share_waiting.png']);
  });
});

describe('share batch acknowledgement', () => {
  it.each(['android', 'ios'] as const)(
    'keeps the next %s batch when a canceled composer finishes sending',
    async (os) => {
      const target = renderProvider(os);
      const loadBatch = async (token: string) => {
        if (os === 'android') {
          setAndroidFiles([
            { token, name: token, mimeType: 'image/png', size: 3 },
          ]);
        } else {
          nativePending = [token];
          onIosFilesReady?.({ payload: { filenames: [token] } });
        }
        await vi.waitFor(() => expect(pendingTokens(target)).toEqual([token]));
      };

      await loadBatch('batch-a');
      const tokens = pendingTokens(target);
      const posted = Promise.withResolvers<void>();
      const share = createNativeShareSend({
        send: () => posted.promise,
        clear: () => target.clearPendingShareFiles(tokens),
      });
      const sending = share.send('draft');
      await target.clearPendingShareFiles();
      await loadBatch('batch-b');
      posted.resolve();
      await sending;

      expect(pendingTokens(target)).toEqual(['batch-b']);
      const clearCommand =
        os === 'android'
          ? 'plugin:android-mobile|clearShares'
          : 'clear_shared_files';
      expect(
        invoke.mock.calls.filter(([command]) => command === clearCommand)
      ).toEqual([
        [clearCommand, { tokens: ['batch-a'] }],
        [clearCommand, { tokens: ['batch-a'] }],
      ]);
    }
  );
});
