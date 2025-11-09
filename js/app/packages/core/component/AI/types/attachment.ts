import type { ChatAttachmentWithName } from '@service-cognition/generated/schemas';
import type { Accessor, Setter } from 'solid-js';

export type {
  AttachmentMetadata,
  ChatMessageWithAttachments,
} from '@service-cognition/generated/schemas';

export type Attachment = ChatAttachmentWithName;

export type Attachments = {
  attached: Accessor<Attachment[]>;
  setAttached: Setter<Attachment[]>;
  addAttachment: (newAttachment: Attachment) => void;
  removeAttachment: (id: string) => void;
};

export type AttachmentPreview = Pick<Attachment, 'attachmentType' | 'metadata'>;

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
