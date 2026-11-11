import { toast } from '@core/component/Toast/Toast';
import { blockNameToFileExtensions } from '@core/constant/allBlocks';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { HEIC_EXTENSIONS } from '@core/heic';
import { fireAndForget } from '@core/util/fireAndForget';
import { handleFileFolderDrop } from '@core/util/upload';
import {
  createStaticUploadFile,
  createUploadFile,
  createUploadFilePreviewUrl,
  getUploadFileCacheKey,
  type UploadFile,
} from '@core/util/uploadFile';
import { Access } from '@macro-inc/collaboration/session/abi.generated';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { SessionPort } from '@macro-inc/lexical-wasm-view/view/session-port';
import type { ViewNode } from '@macro-inc/lexical-wasm-view/view/types';
import { fileExtension } from '@service-storage/util/filename';
import { createNativeListenerScope } from '../../editing/overlay-hosts/native-listeners';
import { registerNativeFilePaste } from '../file-paste/native';
import { dispatchApplicationCommandSettled } from '../group-b/command';
import { type MediaType, processFile, validateMediaFile } from './io';
import { createNativeMediaUploadEvents } from './native-upload-events';

function isImageFileName(name: string): boolean {
  const extension = fileExtension(name);
  return (
    extension != null &&
    (blockNameToFileExtensions.image.includes(extension) ||
      HEIC_EXTENSIONS.some((candidate) => candidate === extension))
  );
}

// Like Source, copies and undo keep the preview URL and its page-owned upload.
type UploadResult = { ok: true; id: string } | { ok: false; error: unknown };
const uploadsByLocalUrl = new Map<
  string,
  { kind: MediaType; result: Promise<UploadResult> }
>();
const pendingSourceId = '';

/** Media IO for one native document surface. Renderers subscribe to its events. */
export function createNativeImageUploadController() {
  const events = createNativeMediaUploadEvents();
  const uploadsByFile = new Map<string, Promise<string>>();
  let mounted: EditorView | undefined;
  const listeners = createNativeListenerScope();
  let disposed = false;

  const current = (view: EditorView, generation: number) =>
    !disposed &&
    mounted === view &&
    view.isMounted &&
    view.mirror.keyGeneration === generation;

  const editable = (view: EditorView) =>
    view.port instanceof SessionPort &&
    view.port.effectiveAccess() === Access.Edit;

  async function upload(file: UploadFile): Promise<string> {
    const key = await getUploadFileCacheKey(file);
    let pending = uploadsByFile.get(key);
    if (!pending) {
      pending = createStaticUploadFile(file);
      uploadsByFile.set(key, pending);
    }
    try {
      return await pending;
    } catch (error) {
      if (uploadsByFile.get(key) === pending) uploadsByFile.delete(key);
      throw error;
    }
  }

  function follow(
    view: EditorView,
    kind: MediaType,
    generation: number,
    localUrl: string
  ) {
    const upload = uploadsByLocalUrl.get(localUrl);
    if (
      upload?.kind !== kind ||
      events.pending(kind, generation, localUrl) ||
      !current(view, generation)
    )
      return;
    fireAndForget(
      events.track(kind, generation, localUrl, async () => {
        const result = await upload.result;
        if (!current(view, generation) || !editable(view)) return;
        if (!result.ok) throw result.error;
        const { id } = result;
        const url = staticFileIdEndpoint(id);
        const settlement = await dispatchApplicationCommandSettled(
          view,
          'group-b.media',
          {
            action: 'complete',
            kind,
            source_id: pendingSourceId,
            local_url: localUrl,
            id,
            url,
          }
        );
        if (settlement.status === 'error') throw settlement.error;
        if (settlement.status === 'success' && settlement.handled)
          return { id, url };
      }),
      `native-${kind}-upload`
    );
  }

  function followNode(view: EditorView, generation: number, node?: ViewNode) {
    if (node?.type !== 'image' && node?.type !== 'video') return;
    const { srcType, id, url } = node.props();
    if (
      srcType === 'local' &&
      id === pendingSourceId &&
      typeof url === 'string'
    )
      follow(view, node.type, generation, url);
  }

  async function insertFile(
    file: File,
    kind: MediaType = 'image'
  ): Promise<boolean> {
    const view = mounted;
    const generation = view?.mirror.keyGeneration;
    if (
      !view ||
      generation == null ||
      !current(view, generation) ||
      !editable(view) ||
      view.root.contentEditable !== 'true'
    )
      return false;
    const processed = await processFile(createUploadFile(file));
    if (
      !current(view, generation) ||
      !editable(view) ||
      view.root.contentEditable !== 'true' ||
      !validateMediaFile(processed, kind)
    )
      return false;

    const localUrl = createUploadFilePreviewUrl(processed);
    const result = await dispatchApplicationCommandSettled(
      view,
      'group-b.media',
      {
        action: 'insert',
        kind,
        media: { srcType: 'local', url: localUrl },
      }
    );
    if (result.status === 'error') throw result.error;
    if (result.status !== 'success' || !result.handled) return false;

    uploadsByLocalUrl.set(localUrl, {
      kind,
      result: upload(processed).then<UploadResult, UploadResult>(
        (id) => ({ ok: true, id }),
        (error: unknown) => ({ ok: false, error })
      ),
    });
    follow(view, kind, generation, localUrl);
    return true;
  }

  return {
    events,
    insertFile,
    bindView(view: EditorView) {
      if (disposed || mounted)
        throw new Error('Image uploads require one live view');
      mounted = view;
      try {
        listeners.add(
          view.onCommit((commit) => {
            const generation = view.mirror.keyGeneration;
            if (generation === null) return;
            for (const mutation of commit.mutations.values())
              followNode(view, generation, mutation.after);
          })
        );
        listeners.add(
          registerNativeFilePaste(view, {
            accepts({ files, entries, directories, mobileImageRecovery }) {
              const names = files.length
                ? files.map((file) => file.name)
                : entries.map((entry) => entry.name);
              return (
                !directories.length &&
                (names.length > 0
                  ? names.every(isImageFileName)
                  : mobileImageRecovery)
              );
            },
            onPasteFilesAndDirs(files, directories) {
              const generation = view.mirror.keyGeneration;
              if (generation === null) return;
              fireAndForget(
                handleFileFolderDrop(files, directories, async (entries) => {
                  for (const entry of entries) {
                    if (
                      !current(view, generation) ||
                      !editable(view) ||
                      view.root.contentEditable !== 'true'
                    )
                      return;
                    if (
                      !entry.isFolder &&
                      !(await insertFile(entry.file)) &&
                      current(view, generation) &&
                      editable(view) &&
                      view.root.contentEditable === 'true'
                    )
                      toast.failure('Invalid media attachment file(s)');
                  }
                }),
                'native-image-paste'
              );
            },
          })
        );
      } catch (error) {
        disposed = true;
        mounted = undefined;
        events.dispose();
        listeners.fail(error);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mounted = undefined;
      try {
        listeners.dispose();
      } finally {
        events.dispose();
      }
    },
  };
}
