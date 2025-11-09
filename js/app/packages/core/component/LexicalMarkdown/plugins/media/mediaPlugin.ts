import { blockNameToFileExtensionSet } from '@core/constant/allBlocks';
import { staticFileIdEndpoint } from '@core/constant/servers';
import { heicConversionService } from '@core/heic/service';
import type { FetchError } from '@core/service';
import { createStaticFile } from '@core/util/create';
import { contentHash } from '@core/util/hash';
import { type MaybeResult, mapOk } from '@core/util/maybeResult';
import { mergeRegister } from '@lexical/utils';
import {
  $createImageNode,
  $createVideoNode,
  $isImageNode,
  $isVideoNode,
  type ImageNode,
  type MediaType,
  type VideoNode,
} from '@lexical-core';
import { storageServiceClient } from '@service-storage/client';
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
} from 'lexical';
import { $insertNodesAndSplitList } from '../../utils';
import { mapRegisterDelete } from '../shared';

export type DSSMedia = {
  type: 'dss';
  id: string;
};

export type SFSMedia = {
  type: 'sfs';
  id: string;
};

export type LocalMedia = {
  type: 'local';
  url: string;
  file: File;
};

export type URLMedia = {
  type: 'url';
  url: string;
};

export type MediaSource = DSSMedia | SFSMedia | LocalMedia | URLMedia;
export type MediaSourceType = MediaSource['type'];
export type MediaCreationPayload = Exclude<MediaSource, 'file'> & {
  alt?: string;
  mediaType: MediaType;
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

export function validateMediaFile(file: File, mediaType: MediaType): boolean {
  const ext = fileExtension(file.name);
  return ext != null && blockNameToFileExtensionSet[mediaType].has(ext);
}

export async function addMediaFromFile(
  editor: LexicalEditor,
  file: File,
  mediaType: MediaType
) {
  const processedFile = await processFile(file);
  if (!validateMediaFile(processedFile, mediaType)) return { success: false };
  editor.dispatchCommand(INSERT_MEDIA_COMMAND, {
    type: 'local',
    url: URL.createObjectURL(processedFile),
    file: processedFile,
    mediaType,
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
}): Promise<MaybeResult<FetchError | 'INVALID_DOCUMENT', string>> {
  if (src.type === 'local' || src.type === 'url') return [null, src.url];
  if (src.type === 'sfs') {
    const url = staticFileIdEndpoint(src.id);
    return [null, url];
  }
  if (src.type === 'dss') {
    return mapOk(
      await storageServiceClient.getBinaryDocument({
        documentId: src.id,
      }),
      (res) => res.blobUrl
    );
  }
  console.warn('Get media url failed for src:', src);
  return [null, ''];
}

/**
 * Generate a unique key for a file to prevent duplicate uploads.
 */
async function getFileKey(file: File, chunks = 8) {
  const hash = await contentHash(
    await file.slice(0, chunks * 1024).arrayBuffer()
  );
  return `${file.name}_${file.size}_${hash}`;
}

async function processFile(file: File): Promise<File> {
  if (heicConversionService.canConvert(file)) {
    const convertedFile = await heicConversionService.convertFile(file);
    return convertedFile;
  }
  return file;
}

/**
 * Upload files to the static file service.
 */
async function uploadStaticFiles(
  files: File[],
  onUpload: (id: string) => void,
  onError?: () => void
) {
  for (const file of files) {
    try {
      const processedFile = await processFile(file);
      const id = await createStaticFile(processedFile);
      onUpload(id);
    } catch (_error) {
      onError?.();
    }
  }
}

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
export function $deleteSelectedMedia() {
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
export function $safeInsertMediaNode(node: ImageNode | VideoNode) {
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
  const cachedUploads = new Map<string, string>();
  const activeUploadsByUploadKey = new Map<
    string,
    Array<{ key: NodeKey; mediaType: MediaType }>
  >();
  const staticIdsByLocalUrl = new Map<string, string>();

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
      { discrete: true }
    );
  };

  const handleUpload = async (
    file: File,
    key: NodeKey,
    localUrl: string,
    mediaType: MediaType
  ) => {
    const uploadKey = await getFileKey(file);

    if (cachedUploads.has(uploadKey)) {
      const id = cachedUploads.get(uploadKey)!;
      onStaticIdReturned(key, id, mediaType);
      return;
    }

    if (activeUploadsByUploadKey.has(uploadKey)) {
      activeUploadsByUploadKey.get(uploadKey)!.push({ key, mediaType });
      return;
    }

    activeUploadsByUploadKey.set(uploadKey, [{ key, mediaType }]);

    editor.dispatchCommand(UPLOAD_MEDIA_START_COMMAND, [key, mediaType]);

    uploadStaticFiles(
      [file],
      (id) => {
        cachedUploads.set(uploadKey, id);
        staticIdsByLocalUrl.set(localUrl, id);
        onStaticIdReturned(key, id, mediaType);
        if (activeUploadsByUploadKey.has(uploadKey)) {
          const entries = activeUploadsByUploadKey.get(uploadKey)!;
          for (const entry of entries) {
            if (entry.key === key) continue;
            onStaticIdReturned(entry.key, id, entry.mediaType);
          }
          activeUploadsByUploadKey.delete(uploadKey);
        }
      },
      () => {
        activeUploadsByUploadKey.delete(uploadKey);
        editor.dispatchCommand(UPLOAD_MEDIA_FAILURE_COMMAND, [key, mediaType]);
      }
    );
  };

  return mergeRegister(
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
                })
              : $createVideoNode({
                  srcType: payload.type,
                  url: payload.url,
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
                })
              : $createVideoNode({
                  srcType: payload.type,
                  url: payload.url,
                });

          $safeInsertMediaNode(node);
          const nodeKey = node.getKey();
          handleUpload(payload.file, nodeKey, payload.url, mediaType);
          return true;
        }

        if (payload.type === 'dss' || payload.type === 'sfs') {
          const node =
            mediaType === 'image'
              ? $createImageNode({
                  srcType: payload.type,
                  id: payload.id,
                  alt: payload.alt,
                })
              : $createVideoNode({
                  srcType: payload.type,
                  id: payload.id,
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
        editor.update(
          () => {
            const node = $getNodeByKey(key);
            if (!node) return true;

            if (mediaType === 'image' && $isImageNode(node)) {
              const type = node.getSrcType();
              if (type === 'local') {
                const url = node.getUrl();
                if (staticIdsByLocalUrl.has(url)) {
                  const id = staticIdsByLocalUrl.get(url)!;
                  onStaticIdReturned(key, id, mediaType);
                }
              }
              if (type === 'sfs') {
                const id = node.getId();
                setTimeout(() =>
                  editor.dispatchCommand(UPLOAD_MEDIA_SUCCESS_COMMAND, [
                    key,
                    id,
                    mediaType,
                  ])
                );
              }
            } else if (mediaType === 'video' && $isVideoNode(node)) {
              const type = node.getSrcType();
              if (type === 'local') {
                const url = node.getUrl();
                if (staticIdsByLocalUrl.has(url)) {
                  const id = staticIdsByLocalUrl.get(url)!;
                  onStaticIdReturned(key, id, mediaType);
                }
              }
              if (type === 'sfs') {
                const id = node.getId();
                setTimeout(() =>
                  editor.dispatchCommand(UPLOAD_MEDIA_SUCCESS_COMMAND, [
                    key,
                    id,
                    mediaType,
                  ])
                );
              }
            }
          },
          { discrete: true, tag: 'historic' }
        );
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
    )
  );
}

export function mediaPlugin() {
  return (editor: LexicalEditor) => registerMediaPlugin(editor);
}
