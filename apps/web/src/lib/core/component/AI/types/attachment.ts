import type { AttachmentMetadata as GeneratedAttachmentMetadata } from '@service-cognition/generated/schemas/attachmentMetadata';
import type { Entity } from '@service-cognition/generated/schemas/entity';
import type { Accessor, Setter } from 'solid-js';

export type {
  AttachmentMetadata,
  ChatMessageWithAttachments,
} from '@service-cognition/generated/schemas';

export type Attachment = Entity;

export type Attachments = {
  attached: Accessor<Attachment[]>;
  setAttached: Setter<Attachment[]>;
  addAttachment: (newAttachment: Attachment) => void;
  removeAttachment: (id: string) => void;
};

export type AttachmentPreview = {
  entity_type: Entity['entity_type'];
  metadata?: GeneratedAttachmentMetadata;
};

export type UploadError = 'upload' | 'extract';

export type UploadingAttachment = {
  preview: AttachmentPreview;
  upload: Promise<UploadResult>;
};

export type UploadResult =
  | {
      type: 'ok';
      attachment: Attachment;
    }
  | {
      type: 'error';
      preview: AttachmentPreview;
      error: UploadError;
    };

export type SupportedResult = {
  file: File;
  type: 'ok' | 'unsupported';
};

export type UploadQueue = {
  upload: (files: File[]) => SupportedResult[];
  uploading: Accessor<UploadingAttachment[]>;
  popComplete: Accessor<UploadResult[]>;
};
