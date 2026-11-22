import { toast } from '@core/component/Toast/Toast';
import { blockNameToFileExtensions } from '@core/constant/allBlocks';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { HEIC_EXTENSIONS } from '@core/heic';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  handleFileFolderDrop,
  type UploadFileEntry,
  type UploadInput,
} from '@core/util/upload';
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
import type { HistoryItem } from '@queries/history/history';
import { fileExtension } from '@service-storage/util/filename';
import { createNativeListenerScope } from '../../editing/overlay-hosts/native-listeners';
import { uploadEntriesAsItems } from '../../utils/fileUploadUtils';
import { prepareBasicMention } from '../../utils/mentionsUtils';
import {
  type NativeInsertPoint,
  placeAtInsertion,
} from '../drag-insert/native';
import { registerNativeFilePaste } from '../file-paste/native';
import {
  dispatchApplicationCommandSettled,
  dispatchApplicationCommandSettledIfSessionEdit,
} from '../group-b/command';
import { type MediaType, processFile, validateMediaFile } from './io';
import { createNativeMediaUploadEvents } from './native-upload-events';

function inlineMediaKind(name: string): MediaType | undefined {
  const extension = fileExtension(name);
  if (extension == null) return;
  if (
    blockNameToFileExtensions.image.includes(extension) ||
    HEIC_EXTENSIONS.some((candidate) => candidate === extension)
  )
    return 'image';
  if (blockNameToFileExtensions.video.includes(extension)) return 'video';
}

// Like Source, copies and undo keep the preview URL and its page-owned upload.
type UploadResult = { ok: true; id: string } | { ok: false; error: unknown };
const uploadsByLocalUrl = new Map<
  string,
  { kind: MediaType; result: Promise<UploadResult> }
>();
const pendingSourceId = '';

/** Media IO for one native document surface. Renderers subscribe to its events. */
export function createNativeImageUploadController(options?: {
  /** Source filesBlockId: the document that tracks pasted-file mentions. */
  mentionSourceId?: () => string;
}) {
  const events = createNativeMediaUploadEvents();
  const uploadsByFile = new Map<string, Promise<string>>();
  let mounted: EditorView | undefined;
  const listeners = createNativeListenerScope();
  let disposed = false;
  const dialogs = new Set<() => void>();
  listeners.add(() => {
    for (const close of dialogs) close();
  });

  // Source handleBasicMention: track, then insert at the current selection,
  // only while the paste's view generation is still the live one.
  const insertMention = async (
    view: EditorView,
    generation: number,
    item: HistoryItem
  ) => {
    const mention = prepareBasicMention(item, {
      blockId: options?.mentionSourceId?.(),
    });
    const mentionId = mention.tracking ? await mention.tracking : undefined;
    const fresh = () => current(view, generation) && editable(view);
    if (!fresh()) return;
    const payload = mention.payload(mentionId);
    const { mentionUuid, ...fields } = payload;
    const result = await dispatchApplicationCommandSettledIfSessionEdit(
      view,
      'group-b.insert-document-mention',
      () => (mentionUuid === undefined ? fields : { ...fields, mentionUuid }),
      { admit: fresh }
    );
    if (result.status === 'error') throw result.error;
  };
  // Source onFilesReady: inline media first, in order, then the other files
  // and folders uploaded and mentioned, rechecking editability between steps.
  const filesReady =
    (view: EditorView, generation: number, at?: NativeInsertPoint) =>
    async (entries: UploadFileEntry[]) => {
      const writable = () =>
        current(view, generation) &&
        editable(view) &&
        view.root.contentEditable === 'true';
      if (!writable()) return;
      // Source SET_SELECTION_AT_INSERTION before a drop's insertions; a drop
      // whose placement is refused or unhandled inserts nothing.
      if (at && !(await placeAtInsertion(view, at, writable))) return;
      const uploads: UploadInput[] = [];
      for (const entry of entries) {
        if (!writable()) return;
        const kind = entry.isFolder
          ? undefined
          : inlineMediaKind(entry.file.name);
        if (kind === undefined) {
          uploads.push(entry);
          continue;
        }
        if (!(await insertFile(entry.file, kind)) && writable())
          toast.failure('Invalid media attachment file(s)');
      }
      if (!uploads.length || !writable()) return;
      await uploadEntriesAsItems(uploads, writable, (item) =>
        fireAndForget(
          insertMention(view, generation, item),
          'native-file-mention'
        )
      );
    };
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

  function openFileDialog(kind: MediaType | 'all' = 'all'): boolean {
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
    const input = view.root.ownerDocument.createElement('input');
    input.type = 'file';
    input.accept =
      kind === 'all'
        ? 'image/*,video/*'
        : kind === 'video'
          ? 'video/*'
          : 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    let active = true;
    const close = () => {
      if (!active) return;
      active = false;
      input.removeEventListener('change', changed);
      input.removeEventListener('cancel', close);
      dialogs.delete(close);
      input.remove();
    };
    const changed = () => {
      if (
        !current(view, generation) ||
        !editable(view) ||
        view.root.contentEditable !== 'true'
      ) {
        close();
        return;
      }
      const files = input.files;
      if (!files?.length) return;
      for (const file of Array.from(files)) {
        const type = file.type.startsWith('image/')
          ? 'image'
          : file.type.startsWith('video/')
            ? 'video'
            : undefined;
        if (type && (kind === 'all' || kind === type))
          fireAndForget(insertFile(file, type), 'native-media-picker');
      }
      close();
    };
    input.addEventListener('change', changed);
    input.addEventListener('cancel', close);
    dialogs.add(close);
    try {
      view.root.ownerDocument.body.appendChild(input);
      input.click();
    } catch (error) {
      close();
      throw error;
    }
    return true;
  }

  return {
    events,
    insertFile,
    openFileDialog,
    /** Source dropFiles: files dropped on the body land at the drop point. */
    dropFiles(
      files: FileSystemFileEntry[],
      directories: FileSystemDirectoryEntry[],
      at: NativeInsertPoint | null
    ) {
      const view = mounted;
      const generation = view?.mirror.keyGeneration;
      if (!view || generation === null || generation === undefined) return;
      fireAndForget(
        handleFileFolderDrop(
          files,
          directories,
          filesReady(view, generation, at ?? undefined)
        ),
        'native-media-drop'
      );
    },
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
            // Source filePastePlugin: media inline, other files and folders
            // uploaded and mentioned.
            accepts({ files, entries, directories, mobileImageRecovery }) {
              return (
                files.length > 0 ||
                entries.length > 0 ||
                directories.length > 0 ||
                mobileImageRecovery
              );
            },
            onPasteFilesAndDirs(files, directories) {
              const generation = view.mirror.keyGeneration;
              if (generation === null) return;
              fireAndForget(
                handleFileFolderDrop(
                  files,
                  directories,
                  filesReady(view, generation)
                ),
                'native-media-paste'
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
