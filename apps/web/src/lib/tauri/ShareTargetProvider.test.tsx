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
let onIosFilesReady: (() => void) | undefined;
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

function setPageHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('iOS share pickup', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'hidden');
  });

  it('loads a share once when its link and the return to the foreground overlap', async () => {
    const target = renderProvider('ios');
    await vi.waitFor(() => expect(onIosFilesReady).toBeDefined());

    nativePending = ['share_a.png'];
    onIosFilesReady?.();
    setPageHidden(false);

    await vi.waitFor(() =>
      expect(pendingTokens(target)).toEqual(['share_a.png'])
    );
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(
          ([command]) => command === 'get_pending_share_filenames'
        )
      ).toHaveLength(3)
    );
    expect(pendingTokens(target)).toEqual(['share_a.png']);
    expect(
      invoke.mock.calls.filter(([command]) => command === 'clear_shared_files')
    ).toEqual([]);
  });

  it('shows a share whose link never arrived when Macro comes to the foreground', async () => {
    const target = renderProvider('ios');
    await vi.waitFor(() => expect(onIosFilesReady).toBeDefined());

    nativePending = ['share_unlinked.jpg'];
    setPageHidden(true);
    expect(pendingTokens(target)).toEqual([]);
    setPageHidden(false);

    await vi.waitFor(() =>
      expect(pendingTokens(target)).toEqual(['share_unlinked.jpg'])
    );
  });
});
afterEach(cleanup);

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
          onIosFilesReady?.();
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
