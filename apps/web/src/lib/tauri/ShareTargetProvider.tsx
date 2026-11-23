import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { OsType } from '@tauri-apps/plugin-os';
import {
  type Accessor,
  createContext,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  useContext,
} from 'solid-js';
import { useAndroidShares } from './androidShares';

interface StagedSharedFileData {
  token: string;
  name: string;
  mime_type: string;
  size: number;
  preview_path?: string | null;
}

export interface PendingShareFile {
  token: string;
  name: string;
  mimeType: string;
  size: number;
  previewSrc?: string;
  isSharedText?: boolean;
  sharedText?: string;
  sha256?: string;
}

export interface UploadPendingShareFileArgs {
  token: string;
  uploadUrl: string;
  mimeType: string;
}

function isSharedTextMimeType(mimeType: string): boolean {
  return mimeType === 'text/uri-list' || mimeType === 'text/plain';
}

async function getPendingShareFilenames(): Promise<string[]> {
  return invoke<string[]>('get_pending_share_filenames');
}

async function popSharedFiles(
  filenames: string[]
): Promise<PendingShareFile[]> {
  const results = await invoke<StagedSharedFileData[]>('pop_shared_files', {
    filenames,
  });
  return Promise.all(
    results.map(async ({ token, name, mime_type, size, preview_path }) => {
      const isSharedText = isSharedTextMimeType(mime_type);
      const sharedText = isSharedText
        ? await readSharedFileText(token).catch((error) => {
            console.error('failed to read shared text', { token, error });
            return undefined;
          })
        : undefined;

      return {
        token,
        name,
        mimeType: mime_type,
        size,
        previewSrc: preview_path ? convertFileSrc(preview_path) : undefined,
        isSharedText,
        sharedText,
      };
    })
  );
}

async function readSharedFileText(token: string): Promise<string> {
  return invoke<string>('read_shared_file_text', { token });
}

async function clearSharedFiles(tokens: readonly string[]): Promise<void> {
  await invoke('clear_shared_files', { tokens });
}

async function uploadPendingShareFile(
  args: UploadPendingShareFileArgs
): Promise<void> {
  await invoke('upload_staged_file_to_presigned_url', {
    source: 'share',
    token: args.token,
    uploadUrl: args.uploadUrl,
    mimeType: args.mimeType,
  });
}

interface ShareTargetContextValue {
  pendingShareFiles: Accessor<PendingShareFile[]>;
  uploadPendingShareFile: (args: UploadPendingShareFileArgs) => Promise<void>;
  clearPendingShareFiles: (tokens?: readonly string[]) => Promise<void>;
  /**
   * Loads a share waiting in the native layer when none is open (iOS only).
   * The share sheet calls it when it mounts and whenever the app returns to
   * the foreground, so a share whose link never arrived still opens.
   */
  pickUpPendingShareFiles: () => Promise<void>;
}

/**
 * A share link loads exactly the files it names and replaces the open share;
 * a pickup loads whatever native code holds, and only when no share is open.
 */
type ShareLoadTrigger =
  | { kind: 'link'; filenames: string[] }
  | { kind: 'pickup' };

interface ShareFilesReadyPayload {
  filenames: string[];
}

const ShareTargetContext = createContext<ShareTargetContextValue | undefined>(
  undefined
);

export function ShareTargetProvider(props: {
  os: OsType;
  children: JSX.Element;
}) {
  const [pendingShareFiles, setPendingShareFiles] = createSignal<
    PendingShareFile[]
  >([]);

  const clearPendingShareFiles = async (
    tokens: readonly string[] = pendingShareFiles().map((file) => file.token)
  ) => {
    if (tokens.length === 0) return;

    const clearMatchingFiles = () => {
      setPendingShareFiles((current) =>
        current.filter((file) => !tokens.includes(file.token))
      );
    };
    if (props.os !== 'android') clearMatchingFiles();

    try {
      if (props.os === 'android') {
        await invoke('plugin:android-mobile|clearShares', { tokens });
        // A queue notification may already have loaded the next batch.
        clearMatchingFiles();
      } else {
        await clearSharedFiles(tokens);
      }
    } catch (error) {
      console.error('failed to clear shared files', error);
      if (props.os === 'android')
        toast.failure('Unable to clear this share. Please try again.');
    }
  };

  if (props.os === 'android') useAndroidShares(setPendingShareFiles);

  // Native code is the source of truth: `pop_shared_files` takes files out
  // of the pending set, so asking again finds only shares not loaded yet.
  // Loads run one at a time, so two batches can't finish out of order and
  // leave the older one on screen.
  const loadPendingShareFiles = async (trigger: ShareLoadTrigger) => {
    if (trigger.kind === 'pickup' && pendingShareFiles().length > 0) return;
    try {
      const filenames =
        trigger.kind === 'link'
          ? trigger.filenames
          : await getPendingShareFilenames();
      if (filenames.length === 0) return;

      const files = await popSharedFiles(filenames);
      if (files.length === 0) return;

      const previousFiles = pendingShareFiles();
      setPendingShareFiles(files);
      if (previousFiles.length > 0) {
        fireAndForget(
          clearSharedFiles(previousFiles.map((file) => file.token)),
          'share-target'
        );
      }
    } catch (error) {
      console.error('failed to load pending share files', error);
    }
  };

  let queue: Promise<void> = Promise.resolve();
  const syncPendingShareFiles = (trigger: ShareLoadTrigger) => {
    const previous = queue;
    queue = (async () => {
      await previous;
      await loadPendingShareFiles(trigger);
    })();
    return queue;
  };

  const pickUpPendingShareFiles = async () => {
    if (props.os !== 'ios') return;
    await syncPendingShareFiles({ kind: 'pickup' });
  };

  onMount(() => {
    if (props.os !== 'ios') return;

    const unlisten = listen<ShareFilesReadyPayload>(
      'share-files-ready',
      (event) =>
        fireAndForget(
          syncPendingShareFiles({
            kind: 'link',
            filenames: event.payload.filenames,
          }),
          'share-target'
        )
    );
    onCleanup(() =>
      fireAndForget(
        unlisten.then((fn) => fn()),
        'share-target'
      )
    );
  });

  const value: ShareTargetContextValue = {
    pendingShareFiles,
    uploadPendingShareFile,
    clearPendingShareFiles,
    pickUpPendingShareFiles,
  };

  return (
    <ShareTargetContext.Provider value={value}>
      {props.children}
    </ShareTargetContext.Provider>
  );
}

export function useShareTarget() {
  return useContext(ShareTargetContext);
}
