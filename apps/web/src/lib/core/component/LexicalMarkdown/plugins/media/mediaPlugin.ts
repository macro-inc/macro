import { blockNameToFileExtensionSet } from '@core/constant/allBlocks';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { heicConversionService } from '@core/heic/service';
import type { FetchError } from '@core/service';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ResultError } from '@core/util/result';
import {
  createStaticUploadFile,
  createUploadFile,
  createUploadFilePreviewUrl,
  getUploadFileCacheKey,
  type UploadFile,
} from '@core/util/uploadFile';

import { mergeRegister } from '@lexical/utils';
import {
  $createImageNode,
  $createVideoNode,
  $isImageNode,
  $isVideoNode,
  ImageNode,
  type MediaType,
  VideoNode,
} from '@macro-inc/lexical-core';
import { Telemetry } from '@macro-inc/observability';
import { fetchBinaryDocumentData } from '@queries/storage/binary-document';
import { fileExtension } from '@service-storage/util/filename';
import {
  $createNodeSelection,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isNodeSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
  type NodeKey,
  type NodeMutation,
} from 'lexical';
import { ok, type Result, ResultAsync } from 'neverthrow';
import { $insertNodesAndSplitList } from '../../utils';
import { mapRegisterDelete } from '../shared';

type DSSMedia = {
  type: 'dss';
  id: string;
};

type SFSMedia = {
  type: 'sfs';
  id: string;
};

type LocalMedia = {
  type: 'local';
  url: string;
  file: File;
};

type URLMedia = {
  type: 'url';
  url: string;
};

type MediaSource = DSSMedia | SFSMedia | LocalMedia | URLMedia;

type MediaCreationPayload = Exclude<MediaSource, 'file'> & {
  alt?: string;
  mediaType: MediaType;
  constrainedMediaDimensions?: { width: number; height: number };
};

export const INSERT_MEDIA_COMMAND: LexicalCommand<MediaCreationPayload> =
  createCommand('INSERT_MEDIA_COMMAND');

export const UPLOAD_MEDIA_SUCCESS_COMMAND: LexicalCommand<
  [NodeKey, string, MediaType]
> = createCommand('UPLOAD_MEDIA_SUCCESS_COMMAND');

export const UPLOAD_MEDIA_FAILURE_COMMAND: LexicalCommand<
  [NodeKey, MediaType]
> = createCommand('UPLOAD_MEDIA_FAILURE_COMMAND');

export const UPLOAD_MEDIA_START_COMMAND: LexicalCommand<[NodeKey, MediaType]> =
  createCommand('UPLOAD_MEDIA_START_COMMAND');

export const ON_MEDIA_COMPONENT_MOUNT_COMMAND: LexicalCommand<
  [NodeKey, MediaType]
> = createCommand('ON_MEDIA_COMPONENT_MOUNT_COMMAND');

export const UPDATE_MEDIA_SIZE_COMMAND: LexicalCommand<
  [NodeKey, { width: number; height: number }, MediaType]
> = createCommand('UPDATE_MEDIA_SIZE_COMMAND');

type MediaPick = MediaType | 'all';

export const TRY_INSERT_MEDIA_UPLOAD_COMMAND: LexicalCommand<
  | MediaPick
  | {
      mediaType: MediaPick;
      constrainedMediaDimensions: { width: number; height: number };
    }
> = createCommand('TRY_INSERT_MEDIA_UPLOAD_COMMAND');

function validateMediaFile(file: UploadFile, mediaType: MediaType): boolean {
  const ext = fileExtension(file.name);
  return ext != null && blockNameToFileExtensionSet[mediaType].has(ext);
}

export async function addMediaFromFile(
  editor: LexicalEditor,
  file: File,
  mediaType: MediaType,
  constrainedMediaDimensions?: { width: number; height: number }
) {
  if (!editor.isEditable()) return { success: false };
  const processedFile = await processFile(createUploadFile(file));
  if (!editor.isEditable()) return { success: false };
  if (!validateMediaFile(processedFile, mediaType)) return { success: false };
  editor.dispatchCommand(INSERT_MEDIA_COMMAND, {
    type: 'local',
    url: createUploadFilePreviewUrl(processedFile),
    file: processedFile.file,
    mediaType,
    constrainedMediaDimensions,
  });
  return { success: true };
}

/**
 * Get the URL for media based on its source type.
 */
export async function getMediaUrl(src: {
  type: string;
  id: string;
  url: string;
}): Promise<Result<string, ResultError<FetchError | 'INVALID_DOCUMENT'>[]>> {
  if (src.type === 'local' || src.type === 'url') return ok(src.url);
  if (src.type === 'sfs') {
    const url = staticFileIdEndpoint(src.id);
    return ok(url);
  }
  if (src.type === 'dss') {
    return (await fetchBinaryDocumentData(src.id)).map((res) => res.blobUrl);
  }
  console.warn('Get media url failed for src:', src);
  return ok('');
}

/**
 * Generate a unique key for a file to prevent duplicate uploads.
 */
async function getFileKey(file: UploadFile, chunks = 8) {
  return getUploadFileCacheKey(file, chunks);
}

async function processFile(file: UploadFile): Promise<UploadFile> {
  if (file.kind === 'browser' && heicConversionService.canConvert(file.file)) {
    return createUploadFile(await heicConversionService.convertFile(file.file));
  }
  return file;
}

/**
 * Upload a file to the static file service. Resolves to its static file id, or
 * undefined when the upload fails.
 */
async function uploadStaticFile(file: File): Promise<string | undefined> {
  const uploaded = await ResultAsync.fromPromise(
    processFile(createUploadFile(file)),
    () => undefined
  ).andThen((processed) =>
    ResultAsync.fromPromise(createStaticUploadFile(processed), () => undefined)
  );
  return uploaded.unwrapOr(undefined);
}

/**
 * Uploads by the local preview URL their node renders. Copies, moves, undo,
 * and remounts give that node a new key or editor but keep the URL, so every
 * copy, in any editor on the page, receives the upload.
 */
const uploadsByLocalUrl = new Map<string, Promise<string | undefined>>();

/**
 * Convert a keyed node from a local media to a durable static file pointer.
 */
function $staticUploadSuccess(key: NodeKey, id: string, mediaType: MediaType) {
  const node = $getNodeByKey(key);
  if (!node) return;

  if (mediaType === 'image' && $isImageNode(node)) {
    node.setSrcType('sfs', false);
    node.setId(id, false);
    node.setUrl(staticFileIdEndpoint(id), false);
  } else if (mediaType === 'video' && $isVideoNode(node)) {
    node.setSrcType('sfs', false);
    node.setId(id, false);
    node.setUrl(staticFileIdEndpoint(id), false);
  }
}

/**
 * Delete any media nodes that are part of the current node selection.
 */
function $deleteSelectedMedia() {
  const sel = $getSelection();
  if (!$isNodeSelection(sel)) return false;
  let foundNodesToBeDeleted = false;
  for (const node of sel.getNodes()) {
    if (
      ($isImageNode(node) || $isVideoNode(node)) &&
      node.isKeyboardSelectable()
    ) {
      node.remove();
      foundNodesToBeDeleted = true;
    }
  }
  return foundNodesToBeDeleted;
}

/**
 * Safely insert media node handling various selection states.
 */
function $safeInsertMediaNode(node: ImageNode | VideoNode) {
  const selection = $getSelection();

  if (!selection) {
    $insertNodes([node]);
    return;
  }

  if ($isNodeSelection(selection)) {
    const selectedNodes = selection.getNodes();
    const lastNode = selectedNodes.at(-1);
    if (lastNode) {
      if ($isImageNode(lastNode) || $isVideoNode(lastNode)) {
        const w = lastNode.getWidth();
        const h = lastNode.getHeight();
        node.setWidth(w, false);
        node.setHeight(h, false);
        lastNode.replace(node);
        if (selectedNodes.length === 1) {
          const sel = $createNodeSelection();
          sel.add(node.getKey());
          $setSelection(sel);
        }
      } else {
        lastNode.insertAfter(node, true);
      }
    }
    return;
  }

  if ($isRangeSelection(selection)) {
    if (selection.isCollapsed()) {
      const { focus } = selection;
      const focusNode = focus.getNode();
      const focusParent = focusNode.getTopLevelElement();
      if (
        focusParent &&
        focus.offset === 0 &&
        focusParent === $getRoot().getFirstChild()
      ) {
        focusParent.insertBefore(node, true);
        return;
      }
    }
  }
  $insertNodesAndSplitList([node]);
}

/**
 * Upgrade DSS media URL after document checks.
 */
export function $upgradeDSSMediaUrl(
  key: NodeKey,
  url: string,
  mediaType: MediaType
) {
  const node = $getNodeByKey(key);
  if (!node) return;

  if (mediaType === 'image' && $isImageNode(node)) {
    node.setUrl(url, false);
  } else if (mediaType === 'video' && $isVideoNode(node)) {
    node.setUrl(url, false);
  }
}

function registerMediaPlugin(editor: LexicalEditor) {
  let consumeNextDelete = false;
  const uploadsByFileKey = new Map<string, Promise<string | undefined>>();
  const uploadingKeys = new Set<NodeKey>();

  const onStaticIdReturned = (
    key: NodeKey,
    id: string,
    mediaType: MediaType
  ) => {
    editor.update(
      () => {
        $staticUploadSuccess(key, id, mediaType);
        editor.dispatchCommand(UPLOAD_MEDIA_SUCCESS_COMMAND, [
          key,
          id,
          mediaType,
        ]);
      },
      { discrete: true, tag: 'historic' }
    );
  };

  const uploadFile = async (
    file: File,
    mediaType: MediaType
  ): Promise<string | undefined> => {
    const keyed = await ResultAsync.fromPromise(
      getFileKey(createUploadFile(file)),
      (error) => error
    );
    if (keyed.isErr()) {
      Telemetry.error(keyed.error, { surface: 'media-upload', mediaType });
      return undefined;
    }
    const fileKey = keyed.value;
    let upload = uploadsByFileKey.get(fileKey);
    if (!upload) {
      upload = uploadStaticFile(file);
      uploadsByFileKey.set(fileKey, upload);
    }
    const id = await upload;
    if (id === undefined && uploadsByFileKey.get(fileKey) === upload) {
      uploadsByFileKey.delete(fileKey);
    }
    return id;
  };

  const followUpload = async (
    key: NodeKey,
    mediaType: MediaType,
    upload: Promise<string | undefined>
  ) => {
    if (uploadingKeys.has(key)) return;
    uploadingKeys.add(key);
    const id = await upload;
    uploadingKeys.delete(key);
    if (id === undefined) {
      editor.dispatchCommand(UPLOAD_MEDIA_FAILURE_COMMAND, [key, mediaType]);
      return;
    }
    onStaticIdReturned(key, id, mediaType);
  };

  const followCreatedLocalMedia = (
    mutations: Map<NodeKey, NodeMutation>,
    mediaType: MediaType
  ) => {
    for (const [key, mutation] of mutations) {
      if (mutation !== 'created') continue;
      const url = editor.getEditorState().read(() => {
        const node = $getNodeByKey(key);
        if (!node) return undefined;
        return ($isImageNode(node) || $isVideoNode(node)) &&
          node.getSrcType() === 'local'
          ? node.getUrl()
          : undefined;
      });
      const upload = url === undefined ? undefined : uploadsByLocalUrl.get(url);
      if (upload) {
        fireAndForget(followUpload(key, mediaType, upload), 'media-upload');
      }
    }
  };

  // Lexical throws when listening for a node the editor did not register, and
  // chat and calendar editors leave out some media nodes.
  const followCreated = (
    klass: typeof ImageNode | typeof VideoNode,
    mediaType: MediaType
  ) =>
    editor.hasNodes([klass])
      ? editor.registerMutationListener(klass, (mutations) =>
          followCreatedLocalMedia(mutations, mediaType)
        )
      : () => {};

  return mergeRegister(
    followCreated(ImageNode, 'image'),
    followCreated(VideoNode, 'video'),

    editor.registerCommand(
      INSERT_MEDIA_COMMAND,
      (payload) => {
        const { mediaType } = payload;

        if (payload.type === 'url') {
          const node =
            mediaType === 'image'
              ? $createImageNode({
                  srcType: payload.type,
                  url: payload.url,
                  alt: payload.alt,
                  constrainedWidth: payload.constrainedMediaDimensions?.width,
                  constrainedHeight: payload.constrainedMediaDimensions?.height,
                })
              : $createVideoNode({
                  srcType: payload.type,
                  url: payload.url,
                  constrainedWidth: payload.constrainedMediaDimensions?.width,
                  constrainedHeight: payload.constrainedMediaDimensions?.height,
                });
          $safeInsertMediaNode(node);
          return true;
        }

        if (payload.type === 'local') {
          const node =
            mediaType === 'image'
              ? $createImageNode({
                  srcType: payload.type,
                  url: payload.url,
                  alt: payload.alt,
                  constrainedWidth: payload.constrainedMediaDimensions?.width,
                  constrainedHeight: payload.constrainedMediaDimensions?.height,
                })
              : $createVideoNode({
                  srcType: payload.type,
                  url: payload.url,
                  constrainedWidth: payload.constrainedMediaDimensions?.width,
                  constrainedHeight: payload.constrainedMediaDimensions?.height,
                });

          uploadsByLocalUrl.set(
            payload.url,
            uploadFile(payload.file, mediaType)
          );
          $safeInsertMediaNode(node);
          return true;
        }

        if (payload.type === 'dss' || payload.type === 'sfs') {
          const node =
            mediaType === 'image'
              ? $createImageNode({
                  srcType: payload.type,
                  id: payload.id,
                  alt: payload.alt,
                  constrainedWidth: payload.constrainedMediaDimensions?.width,
                  constrainedHeight: payload.constrainedMediaDimensions?.height,
                })
              : $createVideoNode({
                  srcType: payload.type,
                  id: payload.id,
                  constrainedWidth: payload.constrainedMediaDimensions?.width,
                  constrainedHeight: payload.constrainedMediaDimensions?.height,
                });
          $safeInsertMediaNode(node);
        }
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      KEY_DELETE_COMMAND,
      () => {
        consumeNextDelete = $deleteSelectedMedia();
        return consumeNextDelete;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      () => {
        consumeNextDelete = $deleteSelectedMedia();
        return consumeNextDelete;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    mapRegisterDelete(
      editor,
      () => {
        if (consumeNextDelete) {
          consumeNextDelete = false;
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      ON_MEDIA_COMPONENT_MOUNT_COMMAND,
      ([key, mediaType]) => {
        if (uploadingKeys.has(key)) {
          editor.dispatchCommand(UPLOAD_MEDIA_START_COMMAND, [key, mediaType]);
          return true;
        }
        const node = $getNodeByKey(key);
        if (!node) return true;
        if (
          ($isImageNode(node) || $isVideoNode(node)) &&
          node.getSrcType() === 'sfs'
        ) {
          const id = node.getId();
          setTimeout(() =>
            editor.dispatchCommand(UPLOAD_MEDIA_SUCCESS_COMMAND, [
              key,
              id,
              mediaType,
            ])
          );
        }
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      UPDATE_MEDIA_SIZE_COMMAND,
      ([key, size, mediaType]) => {
        editor.update(
          () => {
            const node = $getNodeByKey(key);
            if (!node) return;

            if (mediaType === 'image' && $isImageNode(node)) {
              node.setWidth(size.width, false);
              node.setHeight(size.height, false);
            } else if (mediaType === 'video' && $isVideoNode(node)) {
              node.setWidth(size.width, false);
              node.setHeight(size.height, false);
            }
          },
          { discrete: true, tag: 'historic' }
        );
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      TRY_INSERT_MEDIA_UPLOAD_COMMAND,
      (payload) => {
        const { mediaType, constrainedMediaDimensions } =
          typeof payload === 'string'
            ? { mediaType: payload, constrainedMediaDimensions: undefined }
            : payload;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        if (mediaType === 'video') {
          input.accept = 'video/*';
        } else if (mediaType === 'all') {
          input.accept = 'image/*,video/*';
        }
        input.multiple = true;
        input.style.display = 'none';

        input.addEventListener('change', () => {
          const files = input.files;
          if (!files || files.length === 0) return;

          for (const file of Array.from(files)) {
            const isImage = file.type.startsWith('image/');
            const isVideo = file.type.startsWith('video/');
            const type: MediaType | null = isImage
              ? 'image'
              : isVideo
                ? 'video'
                : null;
            if (type && (mediaType === 'all' || type === mediaType)) {
              fireAndForget(
                addMediaFromFile(
                  editor,
                  file,
                  type,
                  constrainedMediaDimensions
                ),
                'media-upload'
              );
            }
          }
          input.remove();
        });

        input.addEventListener('cancel', () => {
          input.remove();
        });
        document.body.appendChild(input);
        input.click();
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    )
  );
}

export function mediaPlugin() {
  return (editor: LexicalEditor) => registerMediaPlugin(editor);
}
