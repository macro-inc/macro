import type { MediaType } from '@macro-inc/lexical-core';
import { createCommand, type LexicalCommand, type NodeKey } from 'lexical';

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

export type MediaCreationPayload = Exclude<MediaSource, 'file'> & {
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
