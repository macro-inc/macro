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

/** Identity returned by a successful save or send. Transport envelopes stay in adapters. */
export interface PersistedEmailIdentity {
  draftId?: string;
  threadId?: string;
  inboxId: string;
}

export interface SaveEmailDraft {
  draft: EmailDraft;
  sendTime?: Date | null;
  previousThreadId?: string;
  inboxId?: string;
  completingThread?: boolean;
}
export interface DeleteEmailDraft {
  draftId: string;
  threadId?: string;
  inboxId?: string;
  completingThread?: boolean;
}
export interface SendEmailDraft {
  message: EmailDraft;
  inboxId?: string;
  completingThread?: boolean;
}
export interface UploadEmailAttachments {
  draftId: string;
  attachments: File[];
  inboxId?: string;
  onAttachmentAdded?: (file: File, id: string) => void;
  onAttachmentUploadFailed?: (file: File) => void;
}
export interface EmailAttachmentChange {
  draftId: string;
  attachmentId: string;
  inboxId?: string;
}

export interface EmailDraftStorage {
  saveDraft(input: SaveEmailDraft): Promise<PersistedEmailIdentity>;
  deleteDraft(input: DeleteEmailDraft): Promise<void>;
  restoreDraft(input: {
    draftId: string;
    threadId?: string;
    draft?: Omit<EmailDraft, 'body_html'>;
    html?: string;
    inboxId?: string;
  }): Promise<void>;
}

export interface EmailAttachmentStorage {
  uploadAttachments(input: UploadEmailAttachments): Promise<void>;
  addForwardedAttachments(input: {
    draftId: string;
    attachments: { attachmentId: string }[];
    inboxId?: string;
  }): Promise<void>;
  removeAttachment(input: EmailAttachmentChange): Promise<void>;
  removeForwardedAttachment(input: EmailAttachmentChange): Promise<void>;
}

export interface EmailDelivery {
  sendMessage(input: SendEmailDraft): Promise<PersistedEmailIdentity>;
  unschedule(input: { draftId: string; inboxId?: string }): Promise<void>;
  schedule(
    input: { draftId: string; sendTime: string },
    inboxId?: string
  ): Promise<void>;
  archive(
    input: { threadId: string; value: boolean },
    inboxId?: string
  ): Promise<void>;
  undoSend(input: {
    threadId?: string;
    draftId: string;
    inboxId: string | undefined;
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

export interface EmailComposeAccounts {
  inboxes: Accessor<EmailInbox[]>;
  loading: Accessor<boolean>;
  failed: Accessor<boolean>;
  primaryId: Accessor<string | undefined>;
}

/** View wiring; controllers do not receive these presentation capabilities. */
export interface EmailComposePresentation {
  viewerLoading: Accessor<boolean>;
  onUpgrade(): void;
  prepareSignatureLinks(root: ShadowRoot): void;
  isTouch: Accessor<boolean>;
  isMobile: Accessor<boolean>;
  scheduleEnabled: boolean;
  signaturesEnabled: Accessor<boolean>;
}

export interface EmailEditorFiles {
  readDroppedFiles: import('./editor-capabilities').ComposeBodyActions['readDroppedFiles'];
  makePublic(id: string): void;
  uploadEditorFiles(input: {
    editor: LexicalEditor | undefined;
    sourceId?: string;
    files: FileSystemFileEntry[];
    directories: FileSystemDirectoryEntry[];
    dropEvent?: DragEvent;
    onUploaded(ids: string[]): void;
  }): void;
}

/** Production composition groups capabilities for views to wire into their consumers. */
export interface EmailComposeContext {
  drafts: EmailDraftStorage;
  attachmentStorage: EmailAttachmentStorage;
  delivery: EmailDelivery;
  notices: EmailComposeFeedback;
  accounts: EmailComposeAccounts;
  presentation: EmailComposePresentation;
  editorFiles: EmailEditorFiles;
  viewerEmail: Accessor<string | undefined>;
  recipients: Accessor<EmailRecipient[]>;
  recipientName(id: string): string;
  hasPaidAccess: Accessor<boolean>;
  recordMention(sourceId: string, targetId: string): void;
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
