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
  invoke.mockReset();
  invoke.mockImplementation(async (command, args) => {
    if (command === 'get_pending_share_filenames') return [];
    if (command === 'pop_shared_files') {
      return args.filenames.map((name: string) => ({
        token: name,
        name,
        mime_type: 'image/png',
        size: 3,
      }));
    }
  });
});
afterEach(cleanup);

describe('share batch acknowledgement', () => {
  it.each(['android', 'ios'] as const)(
    'keeps the next %s batch when a canceled composer finishes sending',
    async (os) => {
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
      const target = context;
      const loadBatch = async (token: string) => {
        if (os === 'android') {
          setAndroidFiles([
            { token, name: token, mimeType: 'image/png', size: 3 },
          ]);
        } else {
          onIosFilesReady?.({ payload: { filenames: [token] } });
        }
        await vi.waitFor(() =>
          expect(target.pendingShareFiles().map((file) => file.token)).toEqual([
            token,
          ])
        );
      };

      await loadBatch('batch-a');
      const tokens = target.pendingShareFiles().map((file) => file.token);
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

      expect(target.pendingShareFiles().map((file) => file.token)).toEqual([
        'batch-b',
      ]);
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
