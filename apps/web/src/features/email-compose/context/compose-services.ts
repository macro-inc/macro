import type { LexicalEditor } from 'lexical';
import type { Accessor } from 'solid-js';
import type { EmailDraft } from '../core/email-draft';
import type { EmailRecipient } from '../core/email-recipient';

export interface EmailInbox {
  id: string;
  email_address: string;
  displayName?: string;
  photo_url?: string | null;
  settings: {
    signature?: string | null;
    signature_on_replies_forwards?: boolean | null;
  };
}

export interface SavedEmailDraft {
  db_id?: string | null;
  thread_db_id?: string | null;
  provider_id?: string | null;
  link_id: string;
}

export interface SaveEmailDraft {
  draft: EmailDraft;
  sendTime?: Date | null;
  previousThreadId?: string;
  linkId?: string;
  completingThread?: boolean;
}
export interface DeleteEmailDraft {
  draftId: string;
  threadId?: string;
  linkId?: string;
  completingThread?: boolean;
}
export interface SendEmailDraft {
  message: EmailDraft;
  linkId?: string;
  completingThread?: boolean;
}
export interface UploadEmailAttachments {
  draftID: string;
  attachments: File[];
  linkId?: string;
  onAttachmentAdded?: (file: File, id: string) => void;
  onAttachmentUploadFailed?: (file: File) => void;
}
export interface EmailAttachmentChange {
  draftID: string;
  attachmentID: string;
  linkId?: string;
}

export interface EmailDraftStorage {
  saveDraft(input: SaveEmailDraft): Promise<{ draft: SavedEmailDraft }>;
  deleteDraft(input: DeleteEmailDraft): Promise<void>;
  restoreDraft(input: {
    draftId: string;
    threadId?: string;
    draft?: Omit<EmailDraft, 'body_html'>;
    html?: string;
    linkId?: string;
  }): Promise<void>;
}

export interface EmailAttachmentStorage {
  uploadAttachments(input: UploadEmailAttachments): Promise<void>;
  addForwardedAttachments(input: {
    draftID: string;
    attachments: { attachmentID: string }[];
    linkId?: string;
  }): Promise<void>;
  removeAttachment(input: EmailAttachmentChange): Promise<void>;
  removeForwardedAttachment(input: EmailAttachmentChange): Promise<void>;
}

export interface EmailDelivery {
  sendMessage(input: SendEmailDraft): Promise<{ message: SavedEmailDraft }>;
  unschedule(input: { draftID: string; linkId?: string }): Promise<void>;
  schedule(
    input: { draftID: string; send_time: string },
    linkId?: string
  ): Promise<void>;
  archive(
    input: { id: string; value: boolean },
    linkId?: string
  ): Promise<void>;
  undoSend(input: {
    threadId?: string;
    draftId: string;
    linkId: string | undefined;
    onUndone: () => Promise<void> | void;
  }): Promise<void>;
}

export interface EmailComposeFeedback {
  feedback: {
    success(
      message: string,
      options?: ComposeNoticeOptions
    ): number | undefined;
    failure(message: string, options?: ComposeNoticeOptions): void;
    alert(message: string, options?: ComposeNoticeOptions): void;
    dismiss(id: number): void;
  };
  reportError(error: unknown): void;
}

/** Composition supplies the complete surface; persistence and delivery consume their own contracts. */
export interface EmailComposeServices
  extends EmailDraftStorage,
    EmailAttachmentStorage,
    EmailDelivery,
    EmailComposeFeedback {
  viewerLoading: Accessor<boolean>;
  onUpgrade(): void;
  prepareSignatureLinks(root: ShadowRoot): void;
  readDroppedFiles: import('./editor-capabilities').ComposeBodyActions['readDroppedFiles'];
  isTouch: Accessor<boolean>;
  isMobile: Accessor<boolean>;
  scheduleEnabled: boolean;
  recipientName(id: string): string;
  recordMention(sourceId: string, targetId: string): void;
  makePublic(id: string): void;
  uploadEditorFiles(input: {
    editor: LexicalEditor | undefined;
    sourceId?: string;
    files: FileSystemFileEntry[];
    directories: FileSystemDirectoryEntry[];
    dropEvent?: DragEvent;
    onUploaded(ids: string[]): void;
  }): void;

  accounts: {
    inboxes: Accessor<EmailInbox[]>;
    loading: Accessor<boolean>;
    failed: Accessor<boolean>;
    primaryId: Accessor<string | undefined>;
  };
  viewerEmail: Accessor<string | undefined>;
  recipients: Accessor<EmailRecipient[]>;
  signaturesEnabled: Accessor<boolean>;
  hasPaidAccess: Accessor<boolean>;
}

export interface ComposeNoticeOptions {
  subtext?: string;
  duration?: number;
  actions?: { label: string; onClick: () => void }[];
}
export interface EmailComposeHost {
  focusSibling?: (direction: 'next' | 'prev') => boolean | void;
  showThread?: (id: string) => void;
  showDraft?: (id: string) => void;
  goBack?: () => void;
  registerBack?: (handler: () => boolean) => void;
}
export interface EmailUndoHandle {
  id: string;
  undo(callbacks?: {
    onSuccess?: () => void;
    onError?: (error: Error) => void;
    onSettled?: () => void;
  }): Promise<void>;
  dispose(): void;
}
